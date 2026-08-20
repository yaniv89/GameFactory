using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Forge.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBuilds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "builds",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    bundle_blob_path = table.Column<string>(type: "text", nullable: true),
                    bundle_sha256 = table.Column<byte[]>(type: "bytea", nullable: true),
                    size_bytes = table.Column<long>(type: "bigint", nullable: true),
                    inline_script_sha256_base64 = table.Column<string>(type: "text", nullable: true),
                    inline_style_sha256_base64 = table.Column<string>(type: "text", nullable: true),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_builds", x => x.id);
                    table.ForeignKey(
                        name: "fk_builds_domain_users_requested_by_user_id",
                        column: x => x.requested_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_builds_project_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "project_revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_builds_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_builds_project_created",
                table: "builds",
                columns: new[] { "project_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_builds_requested_by_user_id",
                table: "builds",
                column: "requested_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_builds_revision_id",
                table: "builds",
                column: "revision_id");

            migrationBuilder.CreateIndex(
                name: "ix_builds_status",
                table: "builds",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "builds");
        }
    }
}
