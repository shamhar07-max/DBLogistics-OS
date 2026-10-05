/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@dbl/ui', '@dbl/contracts', '@dbl/api-client', '@dbl/design-tokens', '@dbl/localization', '@dbl/gateway', '@dbl/configuration'],
  poweredByHeader: false,
  async headers() { return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'same-origin' }] }]; },
};
