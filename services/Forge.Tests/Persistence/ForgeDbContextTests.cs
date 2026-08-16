using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;
using Xunit;

namespace Forge.Tests.Persistence;

/// <summary>
/// Proves the M5 Phase 1 EF Core model against a real Postgres 16 container
/// (Testcontainers, via the Docker daemon CI runs with) — not an in-memory
/// provider, which would silently accept constraint violations the real
/// database rejects (unique indexes, filtered indexes, cascade deletes,
/// citext case-insensitivity).
///
/// Schema is created by applying the real, checked-in EF Core migrations
/// (`Database.MigrateAsync`, `services/Forge.Infrastructure/Persistence/Migrations/`),
/// not `EnsureCreated` — this now proves both the model *and* the
/// migrations that build it are correct against a real database, not
/// just the model in isolation.
///
/// One container is shared across all tests in this class (started once,
/// schema created once) rather than per-test, since spinning up Postgres
/// per test would make this suite slow for no isolation benefit — each
/// test instead uses randomly generated emails/slugs so tests never
/// collide with each other's rows.
/// </summary>
public sealed class ForgeDbContextTests : IAsyncLifetime
{
    private readonly PostgreSqlBuilder _containerBuilder = new PostgreSqlBuilder().WithImage("postgres:16");
    private PostgreSqlContainer _container = null!;
    private DbContextOptions<ForgeDbContext> _options = null!;

    public async Task InitializeAsync()
    {
        _container = _containerBuilder.Build();
        await _container.StartAsync();

        _options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql(_container.GetConnectionString())
            .UseSnakeCaseNamingConvention()
            .Options;

        await using var db = new ForgeDbContext(_options);
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    private ForgeDbContext NewContext() => new(_options);

    private static Workspace NewWorkspace(string slug) => new()
    {
        Slug = slug,
        Name = slug,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static User NewUser(string email) => new()
    {
        IdentitySubjectId = Guid.NewGuid().ToString(),
        Email = email,
        DisplayName = email,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task Committing_A_Revision_Sets_The_Projects_Head_And_Roundtrips_The_Document()
    {
        var slug = $"ws-{Guid.NewGuid():N}";
        await using var db = NewContext();

        var workspace = NewWorkspace(slug);
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();

        // workspace.Id is only real after the save above (it's Postgres-
        // generated, gen_random_uuid()) — building the Project before that
        // point would bake in Guid.Empty, not a deferred/tracked
        // reference, since the FK is set by value rather than navigation.
        var project = new Project
        {
            WorkspaceId = workspace.Id,
            Slug = "two-room-rpg",
            Title = "Two Room RPG",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync();

        var doc = JsonSerializer.SerializeToElement(new { scenes = new object[0] });
        var revision = new ProjectRevision
        {
            ProjectId = project.Id,
            Doc = doc,
            DocHash = new byte[] { 1, 2, 3 },
            SizeBytes = 2,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.ProjectRevisions.Add(revision);
        await db.SaveChangesAsync();

        project.HeadRevision = revision.Id;
        await db.SaveChangesAsync();

        await using var readDb = NewContext();
        var reloaded = await readDb.Projects.SingleAsync(p => p.Id == project.Id);
        Assert.Equal(revision.Id, reloaded.HeadRevision);

        var reloadedRevision = await readDb.ProjectRevisions.SingleAsync(r => r.Id == revision.Id);
        Assert.Equal("scenes", reloadedRevision.Doc.EnumerateObject().Single().Name);
    }

    [Fact]
    public async Task Duplicate_Email_Is_Rejected_Case_Insensitively()
    {
        var localPart = $"dup-{Guid.NewGuid():N}";
        await using var db = NewContext();
        db.DomainUsers.Add(NewUser($"{localPart}@example.com"));
        await db.SaveChangesAsync();

        await using var db2 = NewContext();
        // Different case, same address — proves the citext column type is
        // actually applied, not just a plain text column with a unique
        // index that Postgres would still let two different-cased
        // duplicates through.
        db2.DomainUsers.Add(NewUser($"{localPart.ToUpperInvariant()}@EXAMPLE.com"));

        await Assert.ThrowsAsync<DbUpdateException>(() => db2.SaveChangesAsync());
    }

    [Fact]
    public async Task Duplicate_Slug_Within_One_Workspace_Is_Rejected_But_Allowed_Across_Workspaces()
    {
        var slug = "same-slug";
        await using var db = NewContext();
        var workspaceA = NewWorkspace($"ws-a-{Guid.NewGuid():N}");
        var workspaceB = NewWorkspace($"ws-b-{Guid.NewGuid():N}");
        db.Workspaces.AddRange(workspaceA, workspaceB);
        await db.SaveChangesAsync();

        db.Projects.Add(new Project
        {
            WorkspaceId = workspaceA.Id,
            Slug = slug,
            Title = "A",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        // Same slug, same workspace -> rejected.
        await using var conflictDb = NewContext();
        conflictDb.Projects.Add(new Project
        {
            WorkspaceId = workspaceA.Id,
            Slug = slug,
            Title = "A2",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => conflictDb.SaveChangesAsync());

        // Same slug, different workspace -> allowed.
        await using var okDb = NewContext();
        okDb.Projects.Add(new Project
        {
            WorkspaceId = workspaceB.Id,
            Slug = slug,
            Title = "B",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await okDb.SaveChangesAsync();
    }

    [Fact]
    public async Task A_Workspace_May_Have_At_Most_One_Currently_Active_Subscription()
    {
        await using var db = NewContext();
        var workspace = NewWorkspace($"ws-sub-{Guid.NewGuid():N}");
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();

        db.Subscriptions.Add(new Subscription
        {
            WorkspaceId = workspace.Id,
            StripeCustomerId = "cus_1",
            Plan = "pro",
            Status = SubscriptionStatus.Active,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        // A second "trialing" row for the same workspace also falls inside
        // the filtered index's status set — must be rejected too, not just
        // an exact status match.
        await using var conflictDb = NewContext();
        conflictDb.Subscriptions.Add(new Subscription
        {
            WorkspaceId = workspace.Id,
            StripeCustomerId = "cus_2",
            Plan = "studio",
            Status = SubscriptionStatus.Trialing,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => conflictDb.SaveChangesAsync());

        // A "canceled" row is outside the filtered set, so it coexists
        // fine with the still-active one above.
        await using var okDb = NewContext();
        okDb.Subscriptions.Add(new Subscription
        {
            WorkspaceId = workspace.Id,
            StripeCustomerId = "cus_3",
            Plan = "pro",
            Status = SubscriptionStatus.Canceled,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await okDb.SaveChangesAsync();
    }

    [Fact]
    public async Task Deleting_A_Workspace_Cascades_To_Members_And_Projects()
    {
        await using var db = NewContext();
        var workspace = NewWorkspace($"ws-cascade-{Guid.NewGuid():N}");
        var user = NewUser($"cascade-{Guid.NewGuid():N}@example.com");
        db.Workspaces.Add(workspace);
        db.DomainUsers.Add(user);
        await db.SaveChangesAsync();

        db.WorkspaceMembers.Add(new WorkspaceMember
        {
            WorkspaceId = workspace.Id,
            UserId = user.Id,
            Role = WorkspaceRole.Owner,
            JoinedAt = DateTimeOffset.UtcNow,
        });
        var project = new Project
        {
            WorkspaceId = workspace.Id,
            Slug = "p",
            Title = "P",
            EngineVersion = "0.1.0",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync();

        db.Workspaces.Remove(workspace);
        await db.SaveChangesAsync();

        await using var readDb = NewContext();
        Assert.False(await readDb.WorkspaceMembers.AnyAsync(m => m.WorkspaceId == workspace.Id));
        Assert.False(await readDb.Projects.AnyAsync(p => p.Id == project.Id));
        // The user account itself is not workspace-owned — it survives.
        Assert.True(await readDb.DomainUsers.AnyAsync(u => u.Id == user.Id));
    }
}
