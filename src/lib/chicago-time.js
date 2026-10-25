const { HttpError } = require('./errors');
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function chicagoInput(date) {
  if (!date) return '';
  const parts = Object.fromEntries(formatter.formatToParts(new Date(date)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function parseChicagoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new HttpError(422, 'Enter a complete pickup date and time in America/Chicago.');
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
  if (year < 2000 || year > 2100) throw new HttpError(422, 'Choose a pickup year between 2000 and 2100.');
  const base = Date.UTC(year, month - 1, day, hour, minute);
  const matches = [5, 6].map(offset => new Date(base + offset * 60 * 60 * 1000)).filter(date => chicagoInput(date) === value);
  if (matches.length !== 1) throw new HttpError(422, matches.length ? 'That Chicago time occurs twice during the daylight saving change. Choose an unambiguous time.' : 'That pickup date/time does not exist in America/Chicago.');
  return matches[0];
}
module.exports = { chicagoInput, parseChicagoTime };
