using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Versioning;

namespace Forge.Api.Features.Registry;

/// <summary>docs/SPEC.md Section 13.4: <c>POST /api/v1/registry/resolve</c>.</summary>
public static class ResolveDependenciesEndpoint
{
    public static IEndpointRouteBuilder MapResolveDependencies(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/registry/resolve", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("ResolveDependencies")
            .Produces<ResolveResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return app;
    }

    private static async Task<IResult> Handle(ResolveRequest req, IDependencyResolver resolver, CancellationToken ct)
    {
        if (!SemVer.TryParse(req.EngineVersion, out _))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["engineVersion"] = [$"'{req.EngineVersion}' is not a valid semantic version."],
            });
        }

        try
        {
            var result = await resolver.ResolveAsync(req, ct);
            return TypedResults.Ok(result);
        }
        catch (InvalidRangeException ex)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { [ex.Name] = [ex.Message] });
        }
        catch (PackageNotFoundException ex)
        {
            return TypedResults.Problem(title: "Package not found", detail: ex.Message, statusCode: StatusCodes.Status404NotFound);
        }
        catch (NoSatisfyingVersionException ex)
        {
            return TypedResults.Problem(title: "No satisfying version", detail: ex.Message, statusCode: StatusCodes.Status409Conflict);
        }
    }
}
