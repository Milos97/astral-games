import { Filter, GlProgram } from 'pixi.js';

const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vUv = aPosition;
}
`;

const noise = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}
`;

/**
 * Animated nebula. Applied to a full-screen quad, it ignores its input and
 * generates the sky procedurally (domain-warped fbm). `uMood` blends the base
 * palette into the free-spins palette; `uPulse` flashes on big moments.
 */
export class NebulaFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment: /* glsl */ `
in vec2 vUv;
out vec4 finalColor;
uniform float uTime;
uniform float uMood;
uniform float uPulse;
uniform vec2 uAspect;
${noise}
void main(void) {
  vec2 uv = vUv * uAspect;
  float t = uTime * 0.03;
  vec2 q = vec2(fbm(uv * 1.6 + t), fbm(uv * 1.6 - t + 4.2));
  float n = fbm(uv * 1.8 + q * 1.7 + vec2(t * 0.6, -t * 0.4));

  vec3 deep = mix(vec3(0.02, 0.01, 0.08), vec3(0.06, 0.0, 0.05), uMood);
  vec3 mid  = mix(vec3(0.16, 0.05, 0.38), vec3(0.42, 0.04, 0.22), uMood);
  vec3 hot  = mix(vec3(0.05, 0.55, 0.85), vec3(1.0, 0.55, 0.15), uMood);

  vec3 col = mix(deep, mid, smoothstep(0.25, 0.8, n));
  col = mix(col, hot, smoothstep(0.62, 0.95, n) * 0.55);
  col += hot * pow(max(q.x, 0.0), 3.0) * 0.25;

  float v = length(vUv - 0.5);
  col *= 1.15 - v * 0.9;
  col += uPulse * 0.25 * hot;
  finalColor = vec4(col, 1.0);
}`,
      }),
      resources: {
        nebula: {
          uTime: { value: 0, type: 'f32' },
          uMood: { value: 0, type: 'f32' },
          uPulse: { value: 0, type: 'f32' },
          uAspect: { value: new Float32Array([1.78, 1]), type: 'vec2<f32>' },
        },
      },
    });
  }

  get u() {
    return this.resources.nebula.uniforms as { uTime: number; uMood: number; uPulse: number; uAspect: Float32Array };
  }
}

/**
 * Noise-threshold dissolve with a hot edge, used when winning symbols
 * explode. progress 0 = intact, 1 = gone.
 */
export class DissolveFilter extends Filter {
  constructor(edgeColor: number, seed = Math.random() * 100) {
    const c = [((edgeColor >> 16) & 255) / 255, ((edgeColor >> 8) & 255) / 255, (edgeColor & 255) / 255];
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment: /* glsl */ `
in vec2 vTextureCoord;
in vec2 vUv;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uProgress;
uniform float uSeed;
uniform vec3 uEdge;
${noise}
void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  float n = fbm(vUv * 5.0 + uSeed);
  // radial bias: dissolve from the outside in
  n = mix(n, 1.0 - length(vUv - 0.5) * 1.4, 0.35);
  float p = uProgress * 1.25 - 0.1;
  float edge = smoothstep(p, p + 0.12, n);
  float alive = step(p, n);
  // texture is premultiplied: scale the edge colour by alpha so transparent
  // pixels around the symbol don't light up
  vec3 col = mix(uEdge * 2.0 * src.a, src.rgb, edge);
  finalColor = vec4(col * alive, src.a * alive);
}`,
      }),
      resources: {
        dissolve: {
          uProgress: { value: 0, type: 'f32' },
          uSeed: { value: seed, type: 'f32' },
          uEdge: { value: new Float32Array(c), type: 'vec3<f32>' },
        },
      },
      padding: 0,
    });
  }

  get progress(): number {
    return this.resources.dissolve.uniforms.uProgress;
  }

  set progress(v: number) {
    this.resources.dissolve.uniforms.uProgress = v;
  }
}
