/**
 * GLSL sources for the NWStep planetary system simulation.
 *
 * Everything (rocky displacement, tidal deformation, wind bands, storm
 * clusters, eclipse shadows, the red dwarf surface) is computed in shaders.
 */

export const COMMON_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p, int oct) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      s += a * vnoise(p);
      p = p * 2.03 + vec3(11.7);
      a *= 0.5;
    }
    return s;
  }

  // Ridged multifractal: sharp rocky crests, 0..1
  float ridged(vec3 p, int oct) {
    float a = 0.5;
    float s = 0.0;
    float w = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      float n = vnoise(p);
      n = 1.0 - abs(n * 2.0 - 1.0);
      n = n * n;
      s += a * n * w;
      w = clamp(s * 1.5, 0.0, 1.0);
      p = p * 2.11 + vec3(7.3);
      a *= 0.5;
    }
    return s;
  }

  vec3 rotY(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }
`;

/**
 * Shared eclipse function: analytic soft shadow of spherical moons cast on
 * a point, given the direction to the star. Produces umbra + penumbra, so
 * both moons leave real (moving) shadows on the central planet.
 */
export const ECLIPSE_GLSL = /* glsl */ `
  uniform vec3 uStarPos;
  uniform float uStarRadius;
  uniform vec3 uMoonPos[2];
  uniform float uMoonRadius[2];

  float eclipseShadow(vec3 worldPos, vec3 toStar, float distStar) {
    float shadow = 1.0;
    for (int i = 0; i < 2; i++) {
      vec3 toMoon = uMoonPos[i] - worldPos;
      float distMoon = length(toMoon);
      toMoon /= distMoon;
      float angStar = uStarRadius / distStar;
      float angMoon = uMoonRadius[i] / distMoon;
      float angSep = acos(clamp(dot(toStar, toMoon), -1.0, 1.0));
      shadow *= smoothstep(angMoon - angStar, angMoon + angStar, angSep);
    }
    return shadow;
  }
`;

/**
 * Storm-cluster field: Worley cells advected by latitude-dependent wind
 * bands (200..2000 m/s mapped to visual shear). Each cluster has its own
 * charge/activation and discharges as a sharp lightning pulse.
 */
export const STORM_GLSL = /* glsl */ `
  // Wind angular speed (visual) at a given latitude band.
  float windSpeedAt(float lat, float t) {
    float band = 0.5 + 0.5 * sin(lat * 5.0 + 0.7 + 0.02 * t);
    float fine = 0.5 + 0.5 * sin(lat * 13.0 - 0.4);
    return 0.10 + 0.55 * band + 0.15 * fine;
  }

  // Returns lightning flash intensity (0..~1.5) at a direction from planet center.
  float stormField(vec3 dir, float t) {
    float lat = dir.y;
    vec3 q = rotY(dir, t * windSpeedAt(lat, t));

    float cellScale = 4.5;
    vec3 gp = q * cellScale;
    vec3 gid = floor(gp);
    vec3 gf = fract(gp);

    float minDist = 10.0;
    vec3 cellId = vec3(0.0);
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 o = vec3(float(x), float(y), float(z));
          vec3 r = o + hash33(gid + o) - gf;
          float d = dot(r, r);
          if (d < minDist) {
            minDist = d;
            cellId = gid + o;
          }
        }
      }
    }

    float dist = sqrt(minDist);
    float act = hash13(cellId * 7.13 + 3.7);
    float rate = 0.5 + 2.4 * hash13(cellId * 1.71 + 9.1);
    float phase = 6.28318 * hash13(cellId * 3.37 + 17.3);

    float pulse = pow(max(sin(t * rate + phase), 0.0), 40.0);
    pulse += 0.5 * pow(max(sin(t * rate * 2.7 + phase * 2.0), 0.0), 60.0);

    // Break the discharge into thin branching filaments.
    float filament = smoothstep(0.48, 0.72, fbm(q * 26.0 + cellId, 3));
    pulse *= mix(0.25, 1.0, filament);

    float clusterMask = smoothstep(0.62, 0.12, dist);
    float activeMask = smoothstep(0.35, 0.8, act);
    return pulse * act * clusterMask * activeMask;
  }

  // Electrical activity of the nearest cluster (0..1), used for cloud tinting.
  float stormActivity(vec3 dir, float t) {
    float lat = dir.y;
    vec3 q = rotY(dir, t * windSpeedAt(lat, t));
    vec3 gp = q * 4.5;
    vec3 gid = floor(gp);
    vec3 gf = fract(gp);
    float minDist = 10.0;
    vec3 cellId = vec3(0.0);
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 o = vec3(float(x), float(y), float(z));
          vec3 r = o + hash33(gid + o) - gf;
          float d = dot(r, r);
          if (d < minDist) {
            minDist = d;
            cellId = gid + o;
          }
        }
      }
    }
    float act = hash13(cellId * 7.13 + 3.7);
    float dist = sqrt(minDist);
    return act * smoothstep(0.7, 0.2, dist);
  }
`;

export const PLANET_VERT = /* glsl */ `
  uniform float uBulge;
  uniform float uRockAmp;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vDir;
  varying float vRocks;

  ${COMMON_GLSL}

  // Height field in planet-local space. The tidal bulge points along local +X
  // (the planet is tidally locked to the inner moon, so the moon always sits
  // above that direction in the local frame).
  float terrainHeight(vec3 dir) {
    float bulge = uBulge * (1.5 * dir.x * dir.x - 0.5);

    float warp = vnoise(dir * 2.4 + vec3(5.0));
    vec3 wp = dir * 3.1 + warp * 0.7;
    float r = ridged(wp, 6);
    r = pow(r, 1.5);

    // Large calm plains between the rocky massifs.
    float plains = smoothstep(0.3, 0.72, vnoise(dir * 1.7 + vec3(21.0)));
    float rocks = r * (0.18 + 0.82 * plains);

    return bulge + rocks * uRockAmp;
  }

  void main() {
    vec3 dir = normalize(position);

    float e = 0.004;
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(up, dir));
    vec3 t2 = cross(dir, t1);

    vec3 da = normalize(dir + t1 * e);
    vec3 db = normalize(dir + t2 * e);

    float h = terrainHeight(dir);
    vec3 p0 = dir * (1.0 + h);
    vec3 pa = da * (1.0 + terrainHeight(da));
    vec3 pb = db * (1.0 + terrainHeight(db));

    vec3 n = normalize(cross(pa - p0, pb - p0));

    vRocks = h - uBulge * (1.5 * dir.x * dir.x - 0.5);
    vDir = dir;

    vec4 world = modelMatrix * vec4(p0, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * n);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const PLANET_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPlanetPos;
  uniform vec3 uCamPos;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vDir;
  varying float vRocks;

  ${COMMON_GLSL}
  ${ECLIPSE_GLSL}
  ${STORM_GLSL}

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 toStar = uStarPos - vWorldPos;
    float distStar = length(toStar);
    vec3 L = toStar / distStar;

    float ndl = max(dot(N, L), 0.0);
    float shadow = eclipseShadow(vWorldPos, L, distStar);
    float light = ndl * shadow;

    // --- Rocky surface palette -------------------------------------------
    float hN = clamp(vRocks / 0.12, 0.0, 1.2);

    vec3 cLow  = vec3(0.085, 0.065, 0.060);
    vec3 cMid  = vec3(0.30, 0.20, 0.15);
    vec3 cHigh = vec3(0.56, 0.46, 0.38);

    vec3 col = mix(cLow, cMid, smoothstep(0.05, 0.55, hN));
    col = mix(col, cHigh, smoothstep(0.55, 1.05, hN));

    // Strata / mineral banding.
    float strata = fbm(vDir * 9.0 + vec3(3.0), 5);
    col = mix(col, vec3(0.20, 0.16, 0.13), smoothstep(0.45, 0.75, strata) * 0.45);

    // Sulfur deposits from chemical activity.
    float sulfur = fbm(vDir * 20.0 + vec3(13.0), 4);
    col = mix(col, vec3(0.55, 0.44, 0.14), smoothstep(0.60, 0.85, sulfur) * 0.5);

    // Acid-scoured lowlands (greenish etched terrain).
    float acid = fbm(vDir * 15.0 + vec3(31.0), 4);
    col = mix(col, vec3(0.16, 0.26, 0.12), smoothstep(0.58, 0.85, acid) * (1.0 - hN) * 0.5);

    // --- Lighting ----------------------------------------------------------
    vec3 starTint = vec3(1.0, 0.60, 0.42);
    vec3 diffuse = col * light * starTint * 1.6;
    vec3 ambient = col * vec3(0.085, 0.065, 0.07);

    // Soft camera-side fill so the rocky relief stays readable on the
    // night side (default view looks from behind toward the star).
    vec3 Vf = normalize(uCamPos - vWorldPos);
    float fill = pow(max(dot(N, Vf), 0.0), 1.4) * 0.38;
    diffuse += col * fill * vec3(0.55, 0.65, 0.95);

    // Atmosphere rim scattering on the lit limb.
    vec3 V = normalize(uCamPos - vWorldPos);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 rimGlow = vec3(1.0, 0.45, 0.22) * rim * light * 0.7;

    // --- Thunderstorm clusters ----------------------------------------------
    vec3 dirP = normalize(vWorldPos - uPlanetPos);
    float flash = stormField(dirP, uTime);
    vec3 lightning = vec3(0.55, 0.70, 1.0) * flash * (1.0 - light) * 3.5
                   + vec3(0.75, 0.85, 1.0) * flash * light * 0.35;

    // Acid rain sheen below active clusters (visible on the dark side too).
    float act = stormActivity(dirP, uTime);
    vec3 acidRain = vec3(0.08, 0.16, 0.05) * act * (1.0 - light) * 0.15;

    gl_FragColor = vec4(diffuse + ambient + rimGlow + lightning + acidRain, 1.0);
  }
`;

export const ATMO_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const ATMO_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPlanetPos;
  uniform vec3 uCamPos;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  ${COMMON_GLSL}
  ${ECLIPSE_GLSL}
  ${STORM_GLSL}

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamPos - vWorldPos);

    vec3 dir = normalize(vWorldPos - uPlanetPos);
    float lat = dir.y;

    // Fast zonal winds: shear stretches the clouds into streaks.
    float w = windSpeedAt(lat, uTime);
    vec3 q = rotY(dir, uTime * w);

    float f = fbm(q * 5.0 + vec3(0.0, uTime * 0.03, 0.0), 6);
    float clouds = smoothstep(0.42, 0.85, f);

    vec3 qs = rotY(dir, uTime * w * 1.35);
    float streak = fbm(vec3(qs.x * 11.0, qs.y * 30.0, qs.z * 11.0), 4);
    clouds = clamp(clouds + smoothstep(0.55, 0.82, streak) * 0.45, 0.0, 1.0);

    // Chemical coloration: sulfur orange vs chlorine-green.
    float chem = fbm(q * 3.0 + vec3(17.0), 3);
    vec3 tint = mix(vec3(0.90, 0.48, 0.20), vec3(0.62, 0.80, 0.32), chem);

    // Light + eclipse shadow on the atmosphere.
    vec3 toStar = uStarPos - vWorldPos;
    float distStar = length(toStar);
    vec3 L = toStar / distStar;
    float light = max(dot(N, L), 0.0) * eclipseShadow(vWorldPos, L, distStar);

    // Storm clusters glow through the clouds.
    float flash = stormField(dir, uTime);
    float act = stormActivity(dir, uTime);

    float rim = pow(1.0 - abs(dot(N, V)), 2.4);

    vec3 col = tint * clouds * (0.03 + light * 1.2);
    col += vec3(0.55, 0.72, 1.0) * flash * 3.5;
    col += vec3(0.30, 0.48, 0.16) * act * 0.12;
    col += vec3(1.0, 0.42, 0.20) * rim * (0.08 + light * 0.9);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const STAR_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vObjDir;

  void main() {
    vObjDir = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const STAR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec3 vObjDir;

  ${COMMON_GLSL}

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamPos - vWorldPos);
    float f = max(dot(N, V), 0.0);

    float gran = fbm(vObjDir * 12.0 + vec3(uTime * 0.02), 5);
    float spots = smoothstep(0.60, 0.78, fbm(vObjDir * 4.0 + vec3(31.0), 4));

    // Cool red-dwarf palette: deep red base, faint orange hotspots.
    vec3 base = mix(vec3(0.82, 0.10, 0.02), vec3(1.0, 0.38, 0.10), gran);
    base *= mix(1.0, 0.4, spots);

    // Limb darkening.
    float limb = pow(f, 0.5);
    vec3 col = base * (0.35 + 1.15 * limb);

    gl_FragColor = vec4(col * 1.15, 1.0);
  }
`;

export const GLOW_FRAG = /* glsl */ `
  uniform vec3 uCamPos;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamPos - vWorldPos);
    float rim = pow(1.0 - abs(dot(N, V)), 2.2);
    vec3 col = vec3(1.0, 0.38, 0.16) * rim * rim * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;
