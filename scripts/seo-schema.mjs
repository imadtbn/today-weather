const SITE = 'https://imadtbn.github.io/today-weather';
const WEBSITE_ID = SITE + '/#website';
const ORGANIZATION_ID = SITE + '/#organization';

export function siteEntities() {
  return [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'أحوال الطقس',
      url: SITE + '/',
      email: 'tabaniimadeddine@gmail.com',
      telephone: '+213697743721',
      logo: {
        '@type': 'ImageObject',
        url: SITE + '/assets/images/icon1.webp',
        width: 512,
        height: 512
      }
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: SITE + '/',
      name: 'أحوال الطقس',
      description: 'منصة لمتابعة حالة الطقس الحالية والتوقعات الجوية في الجزائر والمدن والعواصم حول العالم.',
      inLanguage: 'ar',
      publisher: { '@id': ORGANIZATION_ID }
    }
  ];
}

export function breadcrumbSchema(items, id) {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function pageGraph({ url, name, description, image, dateModified, breadcrumbs = [], mainEntity }) {
  const page = {
    '@type': 'WebPage',
    '@id': url + '#webpage',
    url,
    name,
    description,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORGANIZATION_ID },
    inLanguage: 'ar',
    dateModified
  };
  if (image) page.primaryImageOfPage = { '@type': 'ImageObject', url: image };
  if (mainEntity) page.mainEntity = mainEntity;
  const graph = [...siteEntities(), page];
  if (breadcrumbs.length) graph.push(breadcrumbSchema(breadcrumbs, url + '#breadcrumb'));
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function collectionGraph({ url, name, description, image, dateModified, breadcrumbs = [], items = [] }) {
  const page = {
    '@type': 'CollectionPage',
    '@id': url + '#webpage',
    url,
    name,
    description,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORGANIZATION_ID },
    inLanguage: 'ar',
    dateModified,
    mainEntity: {
      '@type': 'ItemList',
      '@id': url + '#itemlist',
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        url: item.url
      }))
    }
  };
  if (image) page.primaryImageOfPage = { '@type': 'ImageObject', url: image };
  const graph = [...siteEntities(), page];
  if (breadcrumbs.length) graph.push(breadcrumbSchema(breadcrumbs, url + '#breadcrumb'));
  return { '@context': 'https://schema.org', '@graph': graph };
}
