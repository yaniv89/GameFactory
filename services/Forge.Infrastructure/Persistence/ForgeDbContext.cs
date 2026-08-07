using Forge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Forge.Infrastructure.Persistence;

/// <summary>
/// EF Core writes always target the primary (docs/SPEC.md Section 5.5) —
/// this context is that primary connection. Dapper reporting queries
/// against a read replica, when they land in a later milestone, are a
/// separate connection string entirely, never this one.
///
/// Only the M5 subset of the Section 6.2 schema is modeled here: identity,
/// workspaces, subscriptions, and projects/revisions. Registry, commerce,
/// and asset tables (packages, listings, purchases, assets,
/// published_builds) are M6/M7 scope and land in a later migration.
/// </summary>
public sealed class ForgeDbContext(DbContextOptions<ForgeDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<Workspace> Workspaces => Set<Workspace>();

    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    public DbSet<Subscription> Subscriptions => Set<Subscription>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<ProjectRevision> ProjectRevisions => Set<ProjectRevision>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Matches the extensions the raw DDL in docs/SPEC.md Section 6.2
        // requires: pgcrypto for gen_random_uuid() defaults, citext for
        // case-insensitive email uniqueness. pg_trgm (trigram search) backs
        // the packages table, which isn't modeled until M6 — added there.
        modelBuilder.HasPostgresExtension("pgcrypto");
        modelBuilder.HasPostgresExtension("citext");

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ForgeDbContext).Assembly);
    }
}
