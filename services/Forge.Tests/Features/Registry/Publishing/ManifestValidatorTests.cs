using System.Text.Json;
using Forge.Api.Features.Registry.Publishing;
using Xunit;

namespace Forge.Tests.Features.Registry.Publishing;

public sealed class ManifestValidatorTests
{
    private static JsonElement Manifest(object shape) => JsonSerializer.SerializeToElement(shape);

    private static object ValidModuleManifest() => new
    {
        name = "@acme/weather",
        version = "1.0.0",
        kind = "module",
        engine = ">=2.0.0 <3.0.0",
        displayName = "Weather",
        summary = "Adds weather.",
        license = "MIT",
        capabilities = new[] { "render", "storage:local" },
    };

    [Fact]
    public void A_Coherent_Module_Manifest_Has_No_Errors()
    {
        var errors = ManifestValidator.Validate(Manifest(ValidModuleManifest()), "@acme/weather", "1.0.0", "module");
        Assert.Empty(errors);
    }

    [Fact]
    public void Name_Mismatch_Is_An_Error()
    {
        var errors = ManifestValidator.Validate(Manifest(ValidModuleManifest()), "@acme/different-name", "1.0.0", "module");
        Assert.Contains("manifest.name", errors.Keys);
    }

    [Fact]
    public void Version_Mismatch_Is_An_Error()
    {
        var errors = ManifestValidator.Validate(Manifest(ValidModuleManifest()), "@acme/weather", "2.0.0", "module");
        Assert.Contains("manifest.version", errors.Keys);
    }

    [Fact]
    public void Invalid_Semver_Version_Is_An_Error()
    {
        var shape = new
        {
            name = "@acme/weather", version = "not-a-version", kind = "module", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "MIT",
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/weather", "not-a-version", "module");
        Assert.Contains("manifest.version", errors.Keys);
    }

    [Fact]
    public void Invalid_Engine_Range_Is_An_Error()
    {
        var shape = new
        {
            name = "@acme/weather", version = "1.0.0", kind = "module", engine = "not-a-range",
            displayName = "x", summary = "x", license = "MIT",
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/weather", "1.0.0", "module");
        Assert.Contains("manifest.engine", errors.Keys);
    }

    [Fact]
    public void An_Unknown_Capability_Is_An_Error()
    {
        var shape = new
        {
            name = "@acme/weather", version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "MIT",
            capabilities = new[] { "filesystem:full-access" },
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/weather", "1.0.0", "module");
        Assert.Contains("manifest.capabilities", errors.Keys);
    }

    [Fact]
    public void The_Network_Capability_Requires_A_Non_Empty_Allowlist()
    {
        var shape = new
        {
            name = "@acme/weather", version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "MIT",
            capabilities = new[] { "network" },
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/weather", "1.0.0", "module");
        Assert.Contains("manifest.networkAllowlist", errors.Keys);
    }

    [Fact]
    public void The_Network_Capability_Passes_With_A_Declared_Allowlist()
    {
        var shape = new
        {
            name = "@acme/weather", version = "1.0.0", kind = "module", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "MIT",
            capabilities = new[] { "network" },
            networkAllowlist = new[] { "api.weather.example" },
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/weather", "1.0.0", "module");
        Assert.Empty(errors);
    }

    [Fact]
    public void An_Art_Pack_Requires_Grid_Tile_Size_And_Implements()
    {
        var shape = new
        {
            name = "@acme/fantasy-pack", version = "1.0.0", kind = "artpack", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "CC-BY-4.0",
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/fantasy-pack", "1.0.0", "artpack");
        Assert.Contains("manifest.grid.tileSize", errors.Keys);
        Assert.Contains("manifest.implements", errors.Keys);
    }

    [Fact]
    public void A_Coherent_Art_Pack_Manifest_Has_No_Errors()
    {
        var shape = new
        {
            name = "@acme/fantasy-pack", version = "1.0.0", kind = "artpack", engine = ">=1.0.0 <2.0.0",
            displayName = "x", summary = "x", license = "CC-BY-4.0",
            grid = new { tileSize = 32 },
            implements = new[] { "forge/topdown-rpg-basic@1" },
        };
        var errors = ManifestValidator.Validate(Manifest(shape), "@acme/fantasy-pack", "1.0.0", "artpack");
        Assert.Empty(errors);
    }

    [Fact]
    public void Missing_Required_Top_Level_Fields_Are_Errors()
    {
        var errors = ManifestValidator.Validate(Manifest(new { }), "@acme/whatever", "1.0.0", "module");
        Assert.Contains("manifest.name", errors.Keys);
        Assert.Contains("manifest.version", errors.Keys);
        Assert.Contains("manifest.kind", errors.Keys);
        Assert.Contains("manifest.engine", errors.Keys);
        Assert.Contains("manifest.displayName", errors.Keys);
        Assert.Contains("manifest.summary", errors.Keys);
        Assert.Contains("manifest.license", errors.Keys);
    }
}
