// ---------------------------------------------------------------------------
// The stylised figure behind the muscle map, as plain data: the in-app map
// (components/BodyMap.jsx, SVG) and the workout share card (share.js, canvas)
// both draw from it, so the picture in the app and the one that gets shared
// can never drift apart.
//
// Each figure sits on a 100 × 214 grid. SILHOUETTE is symmetric and drawn as
// is; LIMBS and the muscle shapes are the figure's left half, mirrored for the
// right. Muscle ids match gym.js MUSCLES.
//
//   { t: "ellipse", cx, cy, rx, ry, rot? }
//   { t: "rect", x, y, w, h, r, rot? }
//   { t: "path", d }
//   rot: [degrees, pivotX, pivotY] — SVG's rotate(a x y)
// ---------------------------------------------------------------------------

export const FIGURE_W = 100;
export const FIGURE_H = 214;
export const FIGURE_GAP = 12; // between the front and back figures

const E = (cx, cy, rx, ry, rot) => ({ t: "ellipse", cx, cy, rx, ry, rot });
const R = (x, y, w, h, r, rot) => ({ t: "rect", x, y, w, h, r, rot });
const P = (d) => ({ t: "path", d });

export const SILHOUETTE = [
  E(50, 13.5, 9.6, 11.6),
  R(45, 23, 10, 13, 3),
  P("M29 35Q50 29.5 71 35L73.5 47Q71.5 74 66.5 98L68.5 115H31.5L33.5 98Q28.5 74 26.5 47Z"),
];

export const LIMBS = [
  R(18.5, 36, 10.4, 43, 5.2, [6, 23.7, 36]),
  R(14.8, 75.5, 8.6, 37, 4.3, [7, 19.1, 75.5]),
  E(14.4, 116.5, 4, 5.6),
  P("M32 110H50L48.4 161Q42.2 167 36 161Z"),
  P("M35.8 159H48L45.6 205H39.4Z"),
  E(42.2, 208.5, 6.4, 3.6),
];

export const FRONT = {
  shoulders: [E(26.2, 42, 6.9, 7.7)],
  chest: [P("M49 38.5C42 37.5 34.5 39 32.5 44.5C31 50 33.5 56.5 40 58C44.5 59 49 57.5 49 55Z")],
  biceps: [E(22.6, 58.5, 4.4, 10.2, [6, 22.6, 58.5])],
  forearms: [E(17.6, 91, 3.8, 12.4, [7, 17.6, 91])],
  abs: [R(43.6, 61.5, 5.6, 9.6, 2.4), R(43.6, 73.2, 5.6, 9.6, 2.4), R(43.6, 84.9, 5.6, 10.6, 2.4)],
  obliques: [P("M35.6 61C37.2 72 38.4 84 39.2 97L42.2 96V62Z")],
  quads: [P("M34 116C32.6 130 34 147 38.6 158.5H45.6C48.6 146 49.3 130 48.3 116Z")],
  calves: [E(39.8, 180, 4.1, 12.6)],
};

export const BACK = {
  upperBack: [P("M50 25.5C46 31 40.5 35 35.6 38.6L42 52.5L50 63.5Z")],
  shoulders: [E(26.2, 42, 6.9, 7.7)],
  lats: [P("M34.8 45C33 56 34.8 72 42.6 87.5L49.2 88.5V66L41.4 54Z")],
  triceps: [E(22.6, 58.5, 4.4, 10.2, [6, 22.6, 58.5])],
  forearms: [E(17.6, 91, 3.8, 12.4, [7, 17.6, 91])],
  lowerBack: [R(43.8, 89, 5.4, 15.5, 2.5)],
  glutes: [E(41.4, 115.5, 8.6, 8.9)],
  hamstrings: [P("M34.2 127C33.6 139 35.6 150.5 39.2 159.5H45.6C48 150.5 48.6 139 48 127Z")],
  calves: [E(40.4, 178.5, 5.2, 12.2)],
};
