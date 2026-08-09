/**
 * AABB collision math, per CLAUDE.md Section 2.3: "Custom AABB + spatial
 * hash. Do not pull in a full physics engine for a top-down RPG." This is
 * deliberately axis-aligned only — `Transform.rotation` is not applied to
 * colliders. A top-down RPG's collision boxes are conventionally
 * unrotated even when the sprite itself rotates (a common simplification
 * in the genre); if a future module genuinely needs rotated hitboxes,
 * that's an oriented-bounding-box narrow phase layered on top of this
 * broad phase, not a change to it.
 */

export const COLLIDER_SHAPE_BOX = 0;
export const COLLIDER_SHAPE_CIRCLE = 1;

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function createAABB(): AABB {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** The Transform fields collision math needs. Matches `@forge/core`'s Transform component shape. */
export interface TransformLike {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/** The Collider fields collision math needs. Matches `@forge/core`'s Collider component shape. */
export interface ColliderLike {
  shape: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Writes the collider's world-space AABB into `out` and returns it — no
 * allocation, so this is safe to call once per entity per fixed step
 * without contributing to frame-loop GC pressure (CLAUDE.md Section 1.3,
 * guardrail 14). Callers that don't care about allocation (tests, one-off
 * editor queries) can pass a freshly `createAABB()`'d scratch object.
 *
 * A circle collider's radius is derived from `width` only (`height` is
 * ignored for circles, matching the convention that a circle collider is
 * defined by one dimension); non-uniform `scaleX`/`scaleY` on a circle is
 * approximated by averaging the two scale factors rather than becoming a
 * true ellipse, which this collision system does not model.
 */
export function computeColliderAABB(transform: TransformLike, collider: ColliderLike, out: AABB): AABB {
  const centerX = transform.x + collider.offsetX * transform.scaleX;
  const centerY = transform.y + collider.offsetY * transform.scaleY;

  if (collider.shape === COLLIDER_SHAPE_CIRCLE) {
    const radius = (collider.width / 2) * ((Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2);
    out.minX = centerX - radius;
    out.minY = centerY - radius;
    out.maxX = centerX + radius;
    out.maxY = centerY + radius;
    return out;
  }

  const halfWidth = (collider.width / 2) * Math.abs(transform.scaleX);
  const halfHeight = (collider.height / 2) * Math.abs(transform.scaleY);
  out.minX = centerX - halfWidth;
  out.minY = centerY - halfHeight;
  out.maxX = centerX + halfWidth;
  out.maxY = centerY + halfHeight;
  return out;
}

function circleCircleOverlap(
  transformA: TransformLike,
  colliderA: ColliderLike,
  transformB: TransformLike,
  colliderB: ColliderLike,
): boolean {
  const centerAx = transformA.x + colliderA.offsetX * transformA.scaleX;
  const centerAy = transformA.y + colliderA.offsetY * transformA.scaleY;
  const centerBx = transformB.x + colliderB.offsetX * transformB.scaleX;
  const centerBy = transformB.y + colliderB.offsetY * transformB.scaleY;

  const radiusA = (colliderA.width / 2) * ((Math.abs(transformA.scaleX) + Math.abs(transformA.scaleY)) / 2);
  const radiusB = (colliderB.width / 2) * ((Math.abs(transformB.scaleX) + Math.abs(transformB.scaleY)) / 2);

  const dx = centerBx - centerAx;
  const dy = centerBy - centerAy;
  const radiusSum = radiusA + radiusB;
  return dx * dx + dy * dy <= radiusSum * radiusSum;
}

function circleBoxOverlap(
  circleTransform: TransformLike,
  circleCollider: ColliderLike,
  boxTransform: TransformLike,
  boxCollider: ColliderLike,
  scratchBoxAABB: AABB,
): boolean {
  const centerX = circleTransform.x + circleCollider.offsetX * circleTransform.scaleX;
  const centerY = circleTransform.y + circleCollider.offsetY * circleTransform.scaleY;
  const radius =
    (circleCollider.width / 2) * ((Math.abs(circleTransform.scaleX) + Math.abs(circleTransform.scaleY)) / 2);

  // The box is unrotated, so its AABB *is* its precise geometry — no separate narrow-phase shape needed.
  const box = computeColliderAABB(boxTransform, boxCollider, scratchBoxAABB);
  const closestX = Math.min(Math.max(centerX, box.minX), box.maxX);
  const closestY = Math.min(Math.max(centerY, box.minY), box.maxY);
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Precise (narrow-phase) overlap test between two colliders. `scratchA`/
 * `scratchB` are caller-owned reusable AABB objects — pass the same two
 * objects across every call in a hot loop rather than allocating fresh
 * ones per pair.
 */
export function collidersOverlap(
  transformA: TransformLike,
  colliderA: ColliderLike,
  transformB: TransformLike,
  colliderB: ColliderLike,
  scratchA: AABB,
  scratchB: AABB,
): boolean {
  const isCircleA = colliderA.shape === COLLIDER_SHAPE_CIRCLE;
  const isCircleB = colliderB.shape === COLLIDER_SHAPE_CIRCLE;

  if (!isCircleA && !isCircleB) {
    return aabbOverlap(
      computeColliderAABB(transformA, colliderA, scratchA),
      computeColliderAABB(transformB, colliderB, scratchB),
    );
  }
  if (isCircleA && isCircleB) {
    return circleCircleOverlap(transformA, colliderA, transformB, colliderB);
  }
  return isCircleA
    ? circleBoxOverlap(transformA, colliderA, transformB, colliderB, scratchB)
    : circleBoxOverlap(transformB, colliderB, transformA, colliderA, scratchA);
}
