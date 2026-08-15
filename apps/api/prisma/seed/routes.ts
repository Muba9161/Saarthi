/**
 * Realistic road corridors used by the demo dataset and the GPS simulator.
 *
 * These are hand-traced polylines following actual national highways at low
 * resolution — enough for the simulator to produce believable movement and
 * headings without depending on a routing API being configured.
 */

export interface Waypoint {
  latitude: number;
  longitude: number;
}

export interface DemoRoute {
  key: string;
  name: string;
  originName: string;
  destinationName: string;
  /** Approximate real-world road distance in km. */
  distanceKm: number;
  points: Waypoint[];
}

export const DEMO_ROUTES: DemoRoute[] = [
  {
    key: 'delhi-jaipur',
    name: 'NH48 — Delhi to Jaipur',
    originName: 'Okhla Industrial Area, New Delhi',
    destinationName: 'Sitapura Industrial Area, Jaipur',
    distanceKm: 268,
    points: [
      { latitude: 28.5355, longitude: 77.271 },
      { latitude: 28.4595, longitude: 77.0266 },
      { latitude: 28.4089, longitude: 76.9789 },
      { latitude: 28.2076, longitude: 76.8548 },
      { latitude: 28.0229, longitude: 76.7794 },
      { latitude: 27.8974, longitude: 76.6066 },
      { latitude: 27.7644, longitude: 76.4363 },
      { latitude: 27.5673, longitude: 76.2401 },
      { latitude: 27.3542, longitude: 76.0234 },
      { latitude: 27.2038, longitude: 75.8648 },
      { latitude: 27.0238, longitude: 75.7873 },
      { latitude: 26.9124, longitude: 75.7873 },
      { latitude: 26.7716, longitude: 75.8241 },
    ],
  },
  {
    key: 'mumbai-pune',
    name: 'NH48 — Mumbai to Pune Expressway',
    originName: 'JNPT Container Yard, Navi Mumbai',
    destinationName: 'Chakan MIDC, Pune',
    distanceKm: 148,
    points: [
      { latitude: 18.9498, longitude: 72.9515 },
      { latitude: 19.0176, longitude: 73.0961 },
      { latitude: 18.9894, longitude: 73.1175 },
      { latitude: 18.9068, longitude: 73.2652 },
      { latitude: 18.8237, longitude: 73.3521 },
      { latitude: 18.7645, longitude: 73.4084 },
      { latitude: 18.7522, longitude: 73.5183 },
      { latitude: 18.7167, longitude: 73.6789 },
      { latitude: 18.6298, longitude: 73.7997 },
      { latitude: 18.5679, longitude: 73.9143 },
      { latitude: 18.6512, longitude: 73.8567 },
      { latitude: 18.7606, longitude: 73.8636 },
    ],
  },
  {
    key: 'kanpur-lucknow',
    name: 'NH27 — Kanpur to Lucknow',
    originName: 'Panki Industrial Area, Kanpur',
    destinationName: 'Amausi Industrial Area, Lucknow',
    distanceKm: 92,
    points: [
      { latitude: 26.4499, longitude: 80.2209 },
      { latitude: 26.4772, longitude: 80.3319 },
      { latitude: 26.5061, longitude: 80.4471 },
      { latitude: 26.5518, longitude: 80.5843 },
      { latitude: 26.6127, longitude: 80.7113 },
      { latitude: 26.6841, longitude: 80.8032 },
      { latitude: 26.7606, longitude: 80.8898 },
      { latitude: 26.8121, longitude: 80.9412 },
      { latitude: 26.8467, longitude: 80.9462 },
    ],
  },
  {
    key: 'ahmedabad-surat',
    name: 'NH48 — Ahmedabad to Surat',
    originName: 'Naroda GIDC, Ahmedabad',
    destinationName: 'Hazira Industrial Area, Surat',
    distanceKm: 265,
    points: [
      { latitude: 23.0709, longitude: 72.6555 },
      { latitude: 22.9734, longitude: 72.6011 },
      { latitude: 22.8137, longitude: 72.5089 },
      { latitude: 22.6013, longitude: 72.6221 },
      { latitude: 22.4231, longitude: 72.7405 },
      { latitude: 22.1836, longitude: 72.8112 },
      { latitude: 21.9412, longitude: 72.9203 },
      { latitude: 21.7645, longitude: 72.9891 },
      { latitude: 21.5222, longitude: 73.0134 },
      { latitude: 21.3009, longitude: 72.9611 },
      { latitude: 21.1702, longitude: 72.8311 },
      { latitude: 21.1013, longitude: 72.6412 },
    ],
  },
  {
    key: 'bengaluru-chennai',
    name: 'NH48 — Bengaluru to Chennai',
    originName: 'Peenya Industrial Area, Bengaluru',
    destinationName: 'Ennore Port, Chennai',
    distanceKm: 348,
    points: [
      { latitude: 13.0287, longitude: 77.5197 },
      { latitude: 12.9916, longitude: 77.6412 },
      { latitude: 12.9698, longitude: 77.7499 },
      { latitude: 12.9591, longitude: 77.9803 },
      { latitude: 12.9165, longitude: 78.1345 },
      { latitude: 12.8342, longitude: 78.4512 },
      { latitude: 12.7409, longitude: 78.7089 },
      { latitude: 12.6819, longitude: 79.0021 },
      { latitude: 12.7523, longitude: 79.3129 },
      { latitude: 12.8342, longitude: 79.6801 },
      { latitude: 12.9612, longitude: 79.9634 },
      { latitude: 13.0921, longitude: 80.1811 },
      { latitude: 13.2145, longitude: 80.3211 },
    ],
  },
];

export function routeByKey(key: string): DemoRoute {
  const route = DEMO_ROUTES.find((candidate) => candidate.key === key);
  if (!route) throw new Error(`Unknown demo route: ${key}`);
  return route;
}
