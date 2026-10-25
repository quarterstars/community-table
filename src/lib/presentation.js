const photos = require('../data/food-photos.json');
const thumbnailFor = image => (/^\/uploads\/food-photos\/[a-f0-9-]+\.webp$/.test(image || '') ? image.replace('.webp', '-thumb.webp') : photos.find(photo => photo.image === image)?.thumbnail);
const zone = 'America/Chicago';

function pickupPresentation(start, end, language = 'en') {
  const dateFormat = new Intl.DateTimeFormat(language === 'am' ? 'am-ET' : 'en-US', { calendar: 'gregory', timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(language === 'am' ? 'am-ET' : 'en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = dateFormat.format(startDate) === dateFormat.format(endDate);
  return {
    pickupDate: dateFormat.format(startDate),
    pickupDateISO: startDate.toISOString(),
    pickupWindow: `${timeFormat.format(startDate)}–${sameDay ? '' : `${dateFormat.format(endDate)}, `}${timeFormat.format(endDate)}`
  };
}

function localizedText(record, language) {
  const available = value => Array.isArray(value) ? value.some(item => typeof item === 'string' && item.trim()) : typeof value === 'string' && value.trim();
  const translated = Object.fromEntries(Object.entries(record.translations?.am || {}).filter(([key, value]) => available(value) && (language === 'am' || !available(record[key]))));
  return { ...record, ...translated };
}
function presentListing(listing, language = 'en') {
  return { ...localizedText(listing, language), id: listing.slug, imageThumbnail: thumbnailFor(listing.image), ...pickupPresentation(listing.pickupStartsAt, listing.pickupEndsAt, language) };
}

function presentReservation(reservation, language = 'en') {
  const start = new Date(reservation.pickupStartsAt), end = new Date(reservation.pickupEndsAt);
  const expired = reservation.status === 'active' && end <= new Date();
  const displayStatus = expired ? 'missed' : reservation.status;
  const locale = language === 'am' ? 'am-ET' : 'en-US';
  const date = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, year: 'numeric', month: 'short', day: 'numeric' });
  const summary = new Intl.DateTimeFormat(locale, { calendar: 'gregory', timeZone: zone, dateStyle: 'medium', timeStyle: 'short' });
  const offsets = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' });
  const offsetAt = value => offsets.formatToParts(value).find(part => part.type === 'timeZoneName').value;
  // Keep DST clock changes unambiguous; ordinary cards use the page's zone label.
  const pickupSummary = offsetAt(start) === offsetAt(end) ? summary.formatRange(start, end) : `${date.format(start)} · ${pickupPresentation(start, end, language).pickupWindow}`;
  return { ...reservation, food: { ...localizedText(reservation.food, language), imageThumbnail: thumbnailFor(reservation.food.image) }, id: reservation._id.toString(), ...pickupPresentation(start, end, language), pickupSummary, pickupHistoryDate: date.formatRange(start, end), displayStatus, statusLabel: expired ? 'Expired' : ({ active: 'Reserved', cancelled: 'Cancelled', collected: 'Collected', missed: 'Missed' }[reservation.status] || reservation.status), canCancel: displayStatus === 'active' };
}

module.exports = { pickupPresentation, presentListing, presentReservation };
