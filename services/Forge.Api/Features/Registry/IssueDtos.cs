namespace Forge.Api.Features.Registry;

public sealed record CreateIssueRequest(string Title, string? Body);

/// <param name="FirstReplyAt">When the package author's earliest reply landed — the same value <c>ListPackagesEndpoint</c>'s own responsiveness-signal query reads, surfaced here so a person browsing issues can see which ones are already answered. Null means no reply yet.</param>
public sealed record IssueResponse(Guid Id, Guid? ReporterUserId, string Title, string? Body, DateTimeOffset CreatedAt, DateTimeOffset? FirstReplyAt);

public sealed record IssueListResponse(IReadOnlyList<IssueResponse> Issues, string? NextCursor);

public sealed record CreateIssueReplyRequest(string Body);

public sealed record IssueReplyResponse(Guid Id, Guid IssueId, Guid? AuthorUserId, string Body, DateTimeOffset CreatedAt);
