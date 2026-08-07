using Forge.Domain.Entities;
using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Forge.Infrastructure.Persistence;

/// <summary>
/// EF Core writes always target the primary (docs/SPEC.md Section 5.5) —
/// this context is that primary connection. Dapper reporting queries
/// against a read replica, when they land in a later milestone, are a
/// separate connection string entirely, never this one.
///
/// Extends <see cref="IdentityDbContext{TUser,TRole,TKey}"/> and also
/// hosts OpenIddict's EF Core stores (<c>UseOpenIddict()</c> below): one
/// physical database, three logically distinct schemas sharing it —
/// ASP.NET Core Identity's own tables (password hashes, security stamps),
/// OpenIddict's own tables (applications, authorizations, tokens), and
/// the hand-modeled domain schema from Section 6.2 below. Identity and
/// OpenIddict's tables are never referenced directly by domain code —
/// docs/SPEC.md Section 23.1 is explicit that <see cref="Domain.Entities.User"/>
/// is a projection linked by <c>IdentitySubjectId</c>, not the same row.
///
/// Only the M5 subset of the Section 6.2 domain schema is modeled here:
/// identity, workspaces, subscriptions, and projects/revisions. Registry,
/// commerce, and asset tables (packages, listings, purchases, assets,
/// published_builds) are M6/M7 scope and land in a later migration.
/// </summary>
public sealed class ForgeDbContext(DbContextOptions<ForgeDbContext> options)
    : IdentityDbContext<ForgeIdentityUser, IdentityRole<Guid>, Guid>(options)
{
    // Not "Users": IdentityDbContext<...> already defines a public Users
    // property (DbSet<ForgeIdentityUser> — Identity's own account rows).
    // Naming this one the same would compile with a "hides inherited
    // member" warning under `new`, but the real problem it papers over is
    // conceptual: this table and Identity's are genuinely different
    // things (docs/SPEC.md Section 23.1), and giving them the same short
    // name invites exactly the kind of "which Users am I looking at"
    // mistake that comment's warning exists to prevent.
    public DbSet<User> DomainUsers => Set<User>();

    public DbSet<Workspace> Workspaces => Set<Workspace>();

    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    public DbSet<Subscription> Subscriptions => Set<Subscription>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<ProjectRevision> ProjectRevisions => Set<ProjectRevision>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder); // Identity's own AspNetUsers/AspNetRoles/etc. tables.
        modelBuilder.UseOpenIddict(); // OpenIddictApplications/Authorizations/Scopes/Tokens tables.

        // Matches the extensions the raw DDL in docs/SPEC.md Section 6.2
        // requires: pgcrypto for gen_random_uuid() defaults, citext for
        // case-insensitive email uniqueness. pg_trgm (trigram search) backs
        // the packages table, which isn't modeled until M6 — added there.
        modelBuilder.HasPostgresExtension("pgcrypto");
        modelBuilder.HasPostgresExtension("citext");

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ForgeDbContext).Assembly);
    }
}
