using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Forge.Api.Features.Registry.Publishing;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Registry.Publishing;

/// <summary>
/// docs/SPEC.md Section 10.4 gates 1–3 plus the immutable-publish
/// mechanics (M6 Phase 2), exercised through the real
/// <c>POST /api/v1/packages/{name}/versions</c> endpoint against a real
/// Azurite container (<see cref="ForgeWebApplicationFactory"/>'s own
/// remarks) — not a fake bundle store, so a broken create-only-if-not-
/// exists check would actually be caught here.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PublishVersionEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public PublishVersionEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static string BundleBase64(string source = "export function setup() {}") =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(source));

    private static object ValidRequest(string name, string version, object? manifestOverrides = null, Dictionary<string, string>? dependencies = null)
    {
        var manifest = manifestOverrides ?? new
        {
            name,
            version,
            kind = "module",
            engine = ">=1.0.0 <2.0.0",
            displayName = "Test Module",
            summary = "A test module.",
            license = "MIT",
        };
        return new
        {
            kind = "module",
            displayName = "Test Module",
            summary = "A test module.",
            readmeMarkdown = (string?)null,
            homepageUrl = (string?)null,
            licenseSpdx = "MIT",
            version,
            engineRange = ">=1.0.0 <2.0.0",
            manifest,
            bundleBase64 = BundleBase64(),
            dependencies,
        };
    }

    [Fact]
    public async Task Publishing_A_New_Package_Succeeds_And_Stays_Pending_Until_The_Smoke_Run_Lands()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-success";

        var response = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"));
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PublishVersionResponse>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(PackageScanStatus.Pending, body!.ScanStatus);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await db.PackageVersions.SingleAsync(v => v.Id == body.VersionId);
        Assert.Equal(PackageScanStatus.Pending, version.ScanStatus);
        Assert.NotEmpty(version.BundleUrl);
        Assert.Equal(32, version.BundleSha256.Length); // sha256 digest length.
    }

    [Fact]
    public async Task Publishing_The_Same_Version_Twice_Is_A_409()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-duplicate";

        var first = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"));
        first.EnsureSuccessStatusCode();

        var second = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task A_Different_Account_Cannot_Publish_A_New_Version_Of_Someone_Elses_Package()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var outsider = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-wrong-author";

        (await owner.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"))).EnsureSuccessStatusCode();

        var response = await outsider.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "2.0.0"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_Unverified_Email_Cannot_Publish()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory, verifyEmail: false);
        var name = "@acme/publish-unverified";

        var response = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_Bundle_Containing_Eval_Is_Blocked()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-eval-blocked";

        var response = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", new
        {
            kind = "module",
            displayName = "Test Module",
            summary = "A test module.",
            readmeMarkdown = (string?)null,
            homepageUrl = (string?)null,
            licenseSpdx = "MIT",
            version = "1.0.0",
            engineRange = ">=1.0.0 <2.0.0",
            manifest = new { name, version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0", displayName = "x", summary = "x", license = "MIT" },
            bundleBase64 = BundleBase64("eval(userInput);"),
            dependencies = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task An_Unresolvable_Dependency_Fails_The_Audit_Gate()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-bad-dependency";

        var response = await author.Client.PostAsJsonAsync(
            $"/api/v1/packages/{name}/versions",
            ValidRequest(name, "1.0.0", dependencies: new Dictionary<string, string> { ["@acme/does-not-exist-publish"] = "^1.0.0" }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task A_Dependency_On_A_Not_Yet_Passed_Sibling_Package_Fails_The_Audit_Gate()
    {
        // Not actually a cycle test, despite the shape (A depends on B,
        // then B depends back on A): every version this endpoint inserts
        // has ScanStatus Pending, since gate 4 (the sandboxed smoke run,
        // M6 Phase 3) doesn't exist yet, and the audit's candidate lookup
        // only ever considers Passed versions. So B declaring a
        // dependency on A fails here for the more basic reason — no
        // Passed version of A exists yet — before cycle detection would
        // even get a chance to run. Real cycle detection, against seeded
        // Passed fixture rows the audit can actually resolve, is
        // <see cref="PackageDependencyAuditorTests.A_Transitive_Self_Reference_Fails_The_Audit_As_A_Cycle"/>.
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var packageA = "@acme/publish-cycle-a";
        var packageB = "@acme/publish-cycle-b";

        (await author.Client.PostAsJsonAsync($"/api/v1/packages/{packageA}/versions", ValidRequest(packageA, "1.0.0"))).EnsureSuccessStatusCode();

        var response = await author.Client.PostAsJsonAsync(
            $"/api/v1/packages/{packageB}/versions",
            ValidRequest(packageB, "1.0.0", dependencies: new Dictionary<string, string> { [packageA] = "^1.0.0" }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task A_Mismatched_Manifest_Name_Is_A_400()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-name-mismatch";

        var response = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", new
        {
            kind = "module",
            displayName = "Test Module",
            summary = "A test module.",
            readmeMarkdown = (string?)null,
            homepageUrl = (string?)null,
            licenseSpdx = "MIT",
            version = "1.0.0",
            engineRange = ">=1.0.0 <2.0.0",
            manifest = new { name = "@acme/completely-different", version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0", displayName = "x", summary = "x", license = "MIT" },
            bundleBase64 = BundleBase64(),
            dependencies = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Malformed_Base64_Is_A_400()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var name = "@acme/publish-bad-base64";

        var response = await author.Client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", new
        {
            kind = "module",
            displayName = "Test Module",
            summary = "A test module.",
            readmeMarkdown = (string?)null,
            homepageUrl = (string?)null,
            licenseSpdx = "MIT",
            version = "1.0.0",
            engineRange = ">=1.0.0 <2.0.0",
            manifest = new { name, version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0", displayName = "x", summary = "x", license = "MIT" },
            bundleBase64 = "not valid base64!!!",
            dependencies = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_Request_Is_Rejected()
    {
        var client = _factory.CreateClient();
        var name = "@acme/publish-unauthenticated";
        var response = await client.PostAsJsonAsync($"/api/v1/packages/{name}/versions", ValidRequest(name, "1.0.0"));
        Assert.False(response.IsSuccessStatusCode);
    }
}
