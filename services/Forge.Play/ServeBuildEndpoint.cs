using Forge.Infrastructure.Storage;

namespace Forge.Play;

/// <summary>
/// docs/adr/0010 Decision 5: <c>GET /{buildId}/</c> and
/// <c>GET /{buildId}/index.html</c> — the whole real surface of the play
/// origin. Public, unauthenticated (published games are public by
/// definition), and reads nothing but Blob Storage: no database round
/// trip, no <c>ICurrentUser</c>, no cookie — see <c>Forge.Play.csproj</c>'s
/// own remarks on why this host has none of those to begin with.
/// </summary>
public static class ServeBuildEndpoint
{
    public static IEndpointRouteBuilder MapServeBuild(this IEndpointRouteBuilder app)
    {
        app.MapGet("/{buildId:guid}/", Handle).WithName("ServeBuildRoot");
        app.MapGet("/{buildId:guid}/index.html", Handle).WithName("ServeBuildIndexHtml");
        return app;
    }

    private static async Task Handle(HttpContext context, Guid buildId, IBuildBundleStorage storage, CancellationToken ct)
    {
        byte[] indexHtml;
        BuildBundleMetadata metadata;
        try
        {
            // Metadata first: a small JSON read, not the (potentially
            // multi-MB) HTML — a buildId with no content should fail
            // cheap.
            metadata = await storage.DownloadMetadataAsync(buildId, ct);
            indexHtml = await storage.DownloadIndexHtmlAsync(buildId, ct);
        }
        catch (BuildBundleNotFoundException)
        {
            // A real "not found," not the cross-tenant-masking 404
            // Forge.Api uses for authorization (docs/adr/0010's own
            // Decision 5 makes this distinction explicitly) — there is no
            // tenant boundary being hidden here, a buildId is either
            // published or it isn't. A real plain-text body, not an empty
            // one: confirmed by a real Chromium navigation that an empty
            // body here made Chromium fail the navigation outright
            // (net::ERR_HTTP_RESPONSE_CODE_FAILURE) rather than rendering
            // an ordinary 404 page — X-Content-Type-Options: nosniff on a
            // bodyless, Content-Type-less error response is the likely
            // trigger; a real Content-Type removes the ambiguity nosniff
            // is checking for either way, so this is a real fix, not a
            // workaround for a test artifact.
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            context.Response.ContentType = "text/plain; charset=utf-8";
            await context.Response.WriteAsync("Not found.", ct);
            return;
        }

        var headers = context.Response.Headers;
        headers["Content-Security-Policy"] = PlaySecurityHeaders.BuildContentSecurityPolicy(
            metadata.InlineScriptSha256Base64, metadata.InlineStyleSha256Base64);
        // Content-addressed by buildId (a fresh Guid per build,
        // docs/adr/0010 Decision 3) — safe to cache forever, and this is
        // exactly the header a real CDN in front of this host would key
        // its own edge caching on.
        headers.CacheControl = "public, max-age=31536000, immutable";
        context.Response.ContentType = "text/html; charset=utf-8";

        await context.Response.Body.WriteAsync(indexHtml, ct);
    }
}
