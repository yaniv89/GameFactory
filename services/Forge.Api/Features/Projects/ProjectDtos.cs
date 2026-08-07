using System.Text.Json;

namespace Forge.Api.Features.Projects;

public sealed record ProjectSummaryResponse(
    Guid Id,
    Guid WorkspaceId,
    string Slug,
    string Title,
    string Visibility,
    long? HeadRevision,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ProjectDetailResponse(
    Guid Id,
    Guid WorkspaceId,
    string Slug,
    string Title,
    string? Description,
    string GenreTemplate,
    string EngineVersion,
    string Visibility,
    long? HeadRevision,
    Guid? CoverAssetId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateProjectRequest(
    string Slug,
    string Title,
    string? Description,
    string EngineVersion,
    string? GenreTemplate);

public sealed record UpdateProjectRequest(
    string? Title,
    string? Description,
    string? Visibility,
    Guid? CoverAssetId);

public sealed record ProjectDocumentResponse(
    long RevisionId,
    long? ParentId,
    string? Label,
    JsonElement Document,
    DateTimeOffset CreatedAt);

public sealed record CommitRevisionRequest(
    long? ExpectedHeadRevision,
    string? Label,
    bool IsCheckpoint,
    JsonElement Document);

public sealed record CommitRevisionResponse(
    long RevisionId,
    string DocHash,
    DateTimeOffset CreatedAt);

public sealed record RevisionSummaryResponse(
    long Id,
    long? ParentId,
    Guid? AuthorId,
    string? Label,
    int SizeBytes,
    bool IsCheckpoint,
    DateTimeOffset CreatedAt);

public sealed record RevisionHistoryResponse(
    IReadOnlyList<RevisionSummaryResponse> Revisions,
    long? NextCursor);

public sealed record RestoreRevisionRequest(long? ExpectedHeadRevision, string? Label);
