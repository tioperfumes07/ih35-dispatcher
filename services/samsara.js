const BASE_URL = 'https://api.samsara.com';

export async function samsaraGet(path, token, query = {}) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.message || `Samsara request failed: ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function getVehicleStats(token, vehicleIds = '') {
  return samsaraGet('/fleet/vehicles/stats', token, {
    types: 'gps,fuelPercents,engineStates',
    vehicleIds: vehicleIds || undefined
  });
}

export async function getHosClocks(token) {
  return samsaraGet('/fleet/hos/clocks', token, {});
}

export async function getDriverVehicleAssignments(token, query = {}) {
  return samsaraGet('/fleet/driver-vehicle-assignments', token, query);
}

export async function getVehicles(token) {
  return samsaraGet('/fleet/vehicles', token, {});
}
