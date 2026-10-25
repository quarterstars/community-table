const amharic = require('./i18n-am.json');
function translator(language = 'en') {
  return (value, values = {}) => {
    const key = String(value ?? '');
    let result = language === 'am' ? amharic[key] : key;
    if (result === undefined && language === 'am') {
      let match;
      if ((match = key.match(/^The limit for this listing is (\d+) portions per account\.$/))) return translator(language)('The limit for this listing is {count} portions per account.', { count: match[1] });
      if ((match = key.match(/^Quantity cannot be below (\d+) reserved, collected, or missed portions\.$/))) return translator(language)('Quantity cannot be below {count} reserved, collected, or missed portions.', { count: match[1] });
      if ((match = key.match(/^Enter a valid .+ \((\d+) characters maximum\)\.$/))) return translator(language)('Enter a valid value (maximum {count} characters).', { count: match[1] });
      if ((match = key.match(/^Enter a whole .+ between (\d+) and (\d+)\.$/))) return translator(language)('Enter a whole number between {min} and {max}.', { min: match[1], max: match[2] });
      result = key; // User-authored content with no translation remains unchanged.
    }
    return (result ?? key).replace(/\{(\w+)\}/g, (placeholder, name) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
  };
}
function localeMiddleware(req, res, next) {
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)community\.lang=(en|am)(?:;|$)/);
  req.language = cookie?.[1] || 'en';
  res.locals.lang = req.language;
  res.locals.t = translator(req.language);
  res.locals.returnTo = req.originalUrl;
  res.locals.formattedDate = date => new Intl.DateTimeFormat(req.language === 'am' ? 'am-ET' : 'en-US', { calendar: 'gregory', timeZone: 'America/Chicago', dateStyle: 'medium' }).format(date);
  next();
}
function safeReturn(value) {
  return typeof value === 'string' && value.length < 2000 && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/';
}
module.exports = { translator, localeMiddleware, safeReturn, amharic };
