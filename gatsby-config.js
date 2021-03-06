const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

module.exports = {
  siteMetadata: {
    title: 'Braden Marshall',
    description: 'The professional publishing platform',
    siteUrl: 'https://bradenm.co.uk', // full path to blog - no ending slash
  },
  plugins: [
    'gatsby-plugin-sitemap',
    'gatsby-plugin-sharp',
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'content',
        path: path.join(__dirname, 'content'),
      },
    },
    {
      resolve: 'gatsby-plugin-mdx',
      options: {
        gatsbyRemarkPlugins: [
          {
            resolve: 'gatsby-remark-responsive-iframe',
            options: {
              wrapperStyle: 'margin-bottom: 1rem',
            },
          },
          'gatsby-remark-prismjs',
          'gatsby-remark-copy-linked-files',
          'gatsby-remark-smartypants',
          'gatsby-remark-abbr',
          {
            resolve: 'gatsby-remark-images',
            options: {
              maxWidth: 1170,
              quality: 90,
            },
          },
        ],
        // https://github.com/gatsbyjs/gatsby/issues/15486#issuecomment-510153237
        plugins: [ 'gatsby-remark-images' ],
      },
    },
    'gatsby-transformer-json',
    {
      resolve: 'gatsby-plugin-canonical-urls',
      options: {
        siteUrl: 'https://bradenm.co.uk',
      },
    },
    {
      resolve: "gatsby-plugin-styled-components",
      options: isDev ? {
        displayName: true,
      } : {
        pure: true,
        minify: true,
        transpileTemplateLiterals: true,
        displayName: false,
      },
    },
    'gatsby-plugin-typescript',
    'gatsby-transformer-sharp',
    {
      resolve: `gatsby-plugin-graphql-codegen`,
      options: {
        fileName: 'types/graphql.d.ts',
        codegen: true,
        codegenDelay: 250,
      },
    },
    'gatsby-plugin-react-helmet',
    {
      resolve: 'gatsby-plugin-typography',
      options: {
        pathToConfigModule: 'src/config/typography.ts',
      },
    },
    'gatsby-transformer-yaml',
    'gatsby-plugin-feed-mdx',
    {
      resolve: `gatsby-plugin-google-analytics`,
      options: {
        trackingId: 'UA-XXXX-Y',
        // Puts tracking script in the head instead of the body
        head: true,
        // IP anonymization for GDPR compliance
        anonymize: true,
        // Disable analytics for users with `Do Not Track` enabled
        respectDNT: true,
        // Avoids sending pageview hits from custom paths
        exclude: ['/preview/**'],
        // Specifies what percentage of users should be tracked
        sampleRate: 100,
        // Determines how often site speed tracking beacons will be sent
        siteSpeedSampleRate: 10,
      },
    },
  ],
};
