export function parseView(search, { slugs = [], countries = [] } = {}) {
  const params = new URLSearchParams(search);
  const site = params.get('site');
  if (site && slugs.includes(site)) return { site };
  const country = (params.get('country') ?? '').toUpperCase();
  if (country && countries.includes(country)) return { country };
  return {};
}

export const viewSearch = (view = {}) => {
  if (view.site) return `?site=${encodeURIComponent(view.site)}`;
  if (view.country) return `?country=${view.country.toLowerCase()}`;
  return '';
};
