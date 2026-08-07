using Microsoft.AspNetCore.Identity;

namespace Forge.Infrastructure.Identity;

/// <summary>
/// ASP.NET Core Identity's own account row — password hash, security
/// stamp, lockout state. Deliberately not the domain's account row
/// (<see cref="Forge.Domain.Entities.User"/>): this <see cref="Id"/> is
/// the token's `sub` claim, and the domain row links back to it via
/// <c>IdentitySubjectId</c> (docs/SPEC.md Section 23.1). No custom fields
/// yet — display name, avatar, and everything else the rest of the
/// domain needs lives on the domain projection instead.
/// </summary>
public sealed class ForgeIdentityUser : IdentityUser<Guid>;
