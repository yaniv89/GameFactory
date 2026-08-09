namespace Forge.Api.Features.Auth;

public static class AuthEndpointsExtensions
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapSignup();
        app.MapVerifyEmail();
        app.MapResendVerification();
        app.MapPasswordEndpoints();
        app.MapLogin();
        app.MapLogout();
        app.MapAuthorize();
        app.MapToken();
        app.MapMe();
        return app;
    }
}
