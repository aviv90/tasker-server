/**
 * Location service constants and data
 */

export interface Continent {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  weight: number;
}

export const continents: Continent[] = [
  { name: 'Western Europe', minLat: 42, maxLat: 60, minLng: -5, maxLng: 15, weight: 2 },
  { name: 'Eastern Europe', minLat: 44, maxLat: 60, minLng: 15, maxLng: 40, weight: 2 },
  { name: 'Southern Europe', minLat: 36, maxLat: 46, minLng: -9, maxLng: 28, weight: 2 },
  { name: 'Scandinavia', minLat: 55, maxLat: 71, minLng: 5, maxLng: 31, weight: 1 },
  { name: 'UK & Ireland', minLat: 50, maxLat: 60, minLng: -10, maxLng: 2, weight: 1 },
  { name: 'China Mainland', minLat: 18, maxLat: 53, minLng: 73, maxLng: 135, weight: 3 },
  { name: 'Japan', minLat: 30, maxLat: 46, minLng: 129, maxLng: 146, weight: 1 },
  { name: 'Korea', minLat: 33, maxLat: 43, minLng: 124, maxLng: 131, weight: 1 },
  { name: 'Mainland Southeast Asia', minLat: 5, maxLat: 28, minLng: 92, maxLng: 109, weight: 2 },
  { name: 'Indonesia West', minLat: -11, maxLat: 6, minLng: 95, maxLng: 120, weight: 1 },
  { name: 'Philippines', minLat: 5, maxLat: 19, minLng: 117, maxLng: 127, weight: 1 },
  { name: 'India', minLat: 8, maxLat: 35, minLng: 68, maxLng: 97, weight: 2 },
  { name: 'Pakistan & Afghanistan', minLat: 24, maxLat: 38, minLng: 60, maxLng: 75, weight: 1 },
  { name: 'Levant & Turkey', minLat: 31, maxLat: 42, minLng: 26, maxLng: 45, weight: 1 },
  { name: 'Arabian Peninsula', minLat: 12, maxLat: 32, minLng: 34, maxLng: 60, weight: 1 },
  { name: 'Iran', minLat: 25, maxLat: 40, minLng: 44, maxLng: 63, weight: 1 },
  { name: 'Eastern USA', minLat: 25, maxLat: 50, minLng: -98, maxLng: -67, weight: 2 },
  { name: 'Western USA', minLat: 31, maxLat: 49, minLng: -125, maxLng: -102, weight: 2 },
  { name: 'Eastern Canada', minLat: 43, maxLat: 62, minLng: -95, maxLng: -52, weight: 1 },
  { name: 'Western Canada', minLat: 49, maxLat: 62, minLng: -140, maxLng: -95, weight: 1 },
  { name: 'Mexico', minLat: 14, maxLat: 32, minLng: -118, maxLng: -86, weight: 1 },
  { name: 'Central America', minLat: 7, maxLat: 18, minLng: -93, maxLng: -77, weight: 1 },
  { name: 'Brazil North', minLat: -10, maxLat: 5, minLng: -74, maxLng: -35, weight: 2 },
  { name: 'Brazil South', minLat: -34, maxLat: -10, minLng: -58, maxLng: -35, weight: 1 },
  { name: 'Andean Countries', minLat: -18, maxLat: 12, minLng: -81, maxLng: -66, weight: 1 },
  { name: 'Chile & Argentina', minLat: -55, maxLat: -22, minLng: -75, maxLng: -53, weight: 1 },
  { name: 'North Africa', minLat: 15, maxLat: 37, minLng: -17, maxLng: 52, weight: 2 },
  { name: 'West Africa', minLat: 4, maxLat: 20, minLng: -17, maxLng: 16, weight: 1 },
  { name: 'East Africa', minLat: -12, maxLat: 16, minLng: 22, maxLng: 51, weight: 1 },
  { name: 'Southern Africa', minLat: -35, maxLat: -15, minLng: 11, maxLng: 42, weight: 1 },
  { name: 'Australia', minLat: -44, maxLat: -10, minLng: 113, maxLng: 154, weight: 2 },
  { name: 'New Zealand', minLat: -47, maxLat: -34, minLng: 166, maxLng: 179, weight: 1 }
];

