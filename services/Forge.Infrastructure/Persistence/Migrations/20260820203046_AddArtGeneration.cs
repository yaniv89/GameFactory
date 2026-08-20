using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Forge.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddArtGeneration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "generation_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_prompt = table.Column<string>(type: "text", nullable: false),
                    category = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    expanded_prompt = table.Column<string>(type: "text", nullable: true),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_generation_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_generation_requests_domain_users_requested_by_user_id",
                        column: x => x.requested_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_generation_requests_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_generation_requests_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "generation_variations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    generation_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    processed_blob_path = table.Column<string>(type: "text", nullable: false),
                    width = table.Column<int>(type: "integer", nullable: false),
                    height = table.Column<int>(type: "integer", nullable: false),
                    selected = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_generation_variations", x => x.id);
                    table.ForeignKey(
                        name: "fk_generation_variations_generation_requests_generation_reques",
                        column: x => x.generation_request_id,
                        principalTable: "generation_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_generation_requests_project_id",
                table: "generation_requests",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_generation_requests_requested_by_user_id",
                table: "generation_requests",
                column: "requested_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_generation_requests_status",
                table: "generation_requests",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_generation_requests_workspace_created",
                table: "generation_requests",
                columns: new[] { "workspace_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_generation_variations_generation_request",
                table: "generation_variations",
                column: "generation_request_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "generation_variations");

            migrationBuilder.DropTable(
                name: "generation_requests");
        }
    }
}
