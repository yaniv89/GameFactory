using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace Forge.Infrastructure.Identity;

/// <summary>
/// Moves the refresh token out of <c>/connect/token</c>'s JSON body and
/// into the httpOnly <see cref="RefreshTokenCookie"/> instead (CLAUDE.md
/// Section 4.7 / Section 12 item 2).
///
/// This is a response-rewriting middleware, not an OpenIddict server event
/// handler, because it isn't one: <c>TokenEndpoint.cs</c> owns the
/// <c>/connect/token</c> response via <c>EnableTokenEndpointPassthrough()</c>
/// + <c>TypedResults.SignIn(...)</c>, and empirically — confirmed with
/// temporary tracing against the real pipeline, not assumed — neither
/// <c>ProcessSignInContext</c> nor <c>ApplyTokenResponseContext</c> handlers
/// registered at <c>SetOrder(int.MaxValue)</c> ever run before the response
/// is written in that passthrough path: several built-in
/// <c>ProcessSignInContext</c> handlers already populate and finalize the
/// response before a max-order custom handler is reached (OpenIddict's
/// dispatcher stops walking a context's handler list once one of them
/// marks the request handled), and <c>ApplyTokenResponseContext</c> turns
/// out to belong to OpenIddict's own non-passthrough response-writing path,
/// which passthrough mode bypasses entirely — this endpoint's response
/// never goes through it. Buffering and rewriting the actual response
/// bytes sidesteps both of those internal-pipeline assumptions rather than
/// chasing a third one.
///
/// <c>ExtractTokenRequestContext</c> (the read side — populating the
/// refresh-token grant's <c>Request.RefreshToken</c> from the cookie) is
/// unaffected by any of this and stays a normal OpenIddict event handler
/// (<c>DependencyInjection.AddForgeAuth</c>): it fires on the *request*
/// side, before passthrough hands control to <c>TokenEndpoint.cs</c>, with
/// no equivalent short-circuiting handler ahead of it.
/// </summary>
public sealed class RefreshTokenCookieMiddleware(RequestDelegate next, IHostEnvironment environment)
{
    private const string TokenPath = "/connect/token";

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path != TokenPath)
        {
            await next(context);
            return;
        }

        var originalBody = context.Response.Body;
        await using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        buffer.Seek(0, SeekOrigin.Begin);

        if (context.Response.StatusCode != StatusCodes.Status200OK
            || context.Response.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) != true)
        {
            await buffer.CopyToAsync(originalBody);
            return;
        }

        using var document = await JsonDocument.ParseAsync(buffer);
        if (!document.RootElement.TryGetProperty("refresh_token", out var refreshTokenElement))
        {
            buffer.Seek(0, SeekOrigin.Begin);
            await buffer.CopyToAsync(originalBody);
            return;
        }

        var refreshToken = refreshTokenElement.GetString();
        if (!string.IsNullOrEmpty(refreshToken))
        {
            context.Response.Cookies.Append(RefreshTokenCookie.Name, refreshToken, RefreshTokenCookie.BuildOptions(environment.IsDevelopment()));
        }

        using var rewritten = new MemoryStream();
        await using (var writer = new Utf8JsonWriter(rewritten))
        {
            writer.WriteStartObject();
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.NameEquals("refresh_token")) continue;
                property.WriteTo(writer);
            }
            writer.WriteEndObject();
        }

        rewritten.Seek(0, SeekOrigin.Begin);
        context.Response.ContentLength = rewritten.Length;
        await rewritten.CopyToAsync(originalBody);
    }
}
