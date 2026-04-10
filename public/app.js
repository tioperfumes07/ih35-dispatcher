async function jget(url) {
  const res = await fetch(url);
  return await res.json();
}

function show(id, data) {
  document.getElementById(id).textContent = JSON.stringify(data, null, 2);
}

function tankGallons(unitName) {
  const unit = String(unitName || '').toUpperCase().replace(/^T/, '');
  return unit === '169' ? 80 : 120;
}

function gallonsLeftFromPercent(unitName, fuelPercent) {
  return tankGallons(unitName) * ((Number(fuelPercent || 0)) / 100);
}

function fuelReachMiles(unitName, fuelPercent, reserve = 35, mpg = 6.5) {
  const gallonsLeft = gallonsLeftFromPercent(unitName, fuelPercent);
  return Math.max(0, gallonsLeft - reserve) * mpg;
}

function hosReachMiles(driveMinutes, shiftMinutes, pcMiles = 45, avgMph = 55) {
  const legalMinutes = Math.min(Number(driveMinutes || 0), Number(shiftMinutes || 0));
  return (legalMinutes / 60) * avgMph + pcMiles;
}

function decision(unitName, fuelPercent, driveMinutes, shiftMinutes) {
  const gallonsLeft = gallonsLeftFromPercent(unitName, fuelPercent);
  const fuelMiles = fuelReachMiles(unitName, fuelPercent);
  const hosMiles = hosReachMiles(driveMinutes, shiftMinutes);

  let status = 'WAIT';
  if (gallonsLeft <= 35 || fuelMiles < 75) status = 'FUEL NOW';
  else if (hosMiles < 90) status = 'BREAK FIRST';

  return {
    unit: unitName,
    tankGallons: tankGallons(unitName),
    fuelPercent: Number(fuelPercent || 0),
    gallonsLeft: Number(gallonsLeft.toFixed(1)),
    fuelReachMiles: Number(fuelMiles.toFixed(1)),
    hosReachMiles: Number(hosMiles.toFixed(1)),
    status
  };
}

document.getElementById('btnHealth').onclick = async () => show('apiOutput', await jget('/api/health'));
document.getElementById('btnVehicles').onclick = async () => show('apiOutput', await jget('/api/samsara/vehicles'));
document.getElementById('btnLive').onclick = async () => show('apiOutput', await jget('/api/samsara/live'));
document.getElementById('btnHos').onclick = async () => show('apiOutput', await jget('/api/samsara/hos'));
document.getElementById('btnAssignments').onclick = async () => show('apiOutput', await jget('/api/samsara/assignments'));

document.getElementById('btnRoute').onclick = async () => {
  const origin = document.getElementById('origin').value;
  const destination = document.getElementById('destination').value;
  const g1 = await jget('/api/geocode?q=' + encodeURIComponent(origin));
  const g2 = await jget('/api/geocode?q=' + encodeURIComponent(destination));
  const coords = `${g1[0].lon},${g1[0].lat};${g2[0].lon},${g2[0].lat}`;
  const route = await jget('/api/route?coords=' + encodeURIComponent(coords));
  show('routeOutput', route);
};

document.getElementById('btnRecommend').onclick = async () => {
  const unit = document.getElementById('unit').value;
  const fuelPercent = Number(document.getElementById('fuelPercent').value);
  const driveLeft = Number(document.getElementById('driveLeft').value);
  const shiftLeft = Number(document.getElementById('shiftLeft').value);

  const result = decision(unit, fuelPercent, driveLeft, shiftLeft);
  show('recommendOutput', result);
};
