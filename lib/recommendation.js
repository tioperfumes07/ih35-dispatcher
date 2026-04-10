function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeTruckProfile(profile, defaults = {}) {
  const unit = String(profile.unit_number || profile.unit || '').trim();
  const tank = unit === '169'
    ? toNumber(profile.tank_capacity_gallons, 80)
    : toNumber(profile.tank_capacity_gallons, toNumber(defaults.tank_capacity_gallons, 120));
  return {
    unit_number: unit,
    samsara_vehicle_id: String(profile.samsara_vehicle_id || '').trim(),
    tank_capacity_gallons: tank,
    reserve_gallons: toNumber(profile.reserve_gallons, toNumber(defaults.reserve_gallons, 35)),
    planning_mpg: toNumber(profile.planning_mpg, toNumber(defaults.planning_mpg, 6.5)),
    target_shift_miles: toNumber(profile.target_shift_miles, toNumber(defaults.target_shift_miles, 750)),
    max_personal_conveyance_miles: toNumber(profile.max_personal_conveyance_miles, toNumber(defaults.max_personal_conveyance_miles, 45)),
    max_detour_miles: toNumber(profile.max_detour_miles, toNumber(defaults.max_detour_miles, 10)),
    target_fill_gallons: toNumber(profile.target_fill_gallons, tank),
    prefer_fuel_during_break: String(profile.prefer_fuel_during_break || 'TRUE').toUpperCase() !== 'FALSE',
    active: String(profile.active || 'TRUE').toUpperCase() !== 'FALSE'
  };
}

export function estimateGallonsLeft(fuelPercent, truck) {
  return truck.tank_capacity_gallons * (toNumber(fuelPercent, 0) / 100);
}

export function estimateFuelReachMiles(gallonsLeft, truck) {
  return Math.max(0, gallonsLeft - truck.reserve_gallons) * truck.planning_mpg;
}

export function estimateHosReachMiles(hos, averageMph = 55) {
  const driveMinutes = toNumber(hos.drive_time_remaining_minutes, 0);
  const shiftMinutes = toNumber(hos.shift_time_remaining_minutes, 0);
  const pcMiles = toNumber(hos.max_personal_conveyance_miles, 0);
  const legalMiles = Math.min(driveMinutes, shiftMinutes) / 60 * averageMph;
  return Math.max(0, legalMiles + pcMiles);
}

export function chooseFuelStop({ truck, fuelPercent, hos, stops }) {
  const gallonsLeft = estimateGallonsLeft(fuelPercent, truck);
  const fuelReachMiles = estimateFuelReachMiles(gallonsLeft, truck);
  const hosReachMiles = estimateHosReachMiles({ ...hos, max_personal_conveyance_miles: truck.max_personal_conveyance_miles });
  const maxReachMiles = Math.min(fuelReachMiles, hosReachMiles);

  const validStops = (stops || [])
    .map((stop) => ({
      ...stop,
      miles_to_stop: toNumber(stop.miles_to_stop),
      miles_off_route: toNumber(stop.miles_off_route),
      diesel_price: toNumber(stop.diesel_price),
    }))
    .filter((stop) => stop.miles_off_route <= truck.max_detour_miles)
    .filter((stop) => stop.miles_to_stop <= maxReachMiles)
    .sort((a, b) => a.diesel_price - b.diesel_price || a.miles_to_stop - b.miles_to_stop);

  const best = validStops[0] || null;
  if (!best) {
    return {
      feasible: false,
      gallons_left: gallonsLeft,
      fuel_reach_miles: fuelReachMiles,
      hos_reach_miles: hosReachMiles,
      max_reach_miles: maxReachMiles,
      recommendation_type: 'urgent_fuel',
      reason: 'No valid stop is reachable within both fuel reserve and HOS limits.',
      stop: null,
      buy_gallons: 0,
      estimated_cost: 0,
      candidates: validStops
    };
  }

  const gallonsUsedToStop = best.miles_to_stop / truck.planning_mpg;
  const gallonsAtStop = Math.max(0, gallonsLeft - gallonsUsedToStop);
  const buyGallons = Math.max(0, Math.min(truck.target_fill_gallons, truck.tank_capacity_gallons) - gallonsAtStop);
  const estimatedCost = buyGallons * best.diesel_price;

  return {
    feasible: true,
    gallons_left: gallonsLeft,
    fuel_reach_miles: fuelReachMiles,
    hos_reach_miles: hosReachMiles,
    max_reach_miles: maxReachMiles,
    recommendation_type: 'fuel_now',
    reason: 'Cheapest currently reachable stop within fuel, detour, and HOS limits.',
    stop: best,
    buy_gallons: buyGallons,
    estimated_cost: estimatedCost,
    candidates: validStops.slice(0, 10)
  };
}
