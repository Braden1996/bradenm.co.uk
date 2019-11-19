import { PageRendererProps } from 'gatsby';
import * as React from 'react';
import Helmet from 'react-helmet';
import normalize from 'normalize.css';

import config from '@config';
import { theme, createGlobalStyle, ThemeProvider } from '@styled';

import favicon from './favicon.ico';
import bgTile from './bgTile.png';

export interface Props extends PageRendererProps {
  className?: string;
}

const GlobalStyle = createGlobalStyle`
  ${normalize}
  html {
    box-sizing: border-box;
    background-color: ${theme.colors.use.background.tertiary};
    position: relative;

    &::before {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      content: '';
      background-image: url(${bgTile});
      filter: invert(33%);
      opacity: 0.2;
      z-index: -1;
    }
  }

  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
`;

const Base: React.FC<Props> = props => (
  <>
    <Helmet>
      <html lang={config.site.lang} />
      <title>{config.site.title}</title>
      <meta name="description" content={config.site.description} />
      <meta property="og:site_name" content={config.site.title} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={config.site.title} />
      <meta property="og:description" content={config.site.description} />
      <meta property="og:url" content={config.site.siteUrl} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={config.site.title} />
      <meta name="twitter:description" content={config.site.description} />
      <meta name="twitter:url" content={config.site.siteUrl} />
      {config.site.twitter && (
        <meta
          name="twitter:site"
          content={`@${config.site.twitter.split('https://twitter.com/')[1]}`}
        />
      )}
      <link rel="icon" href={favicon} type="image/x-icon" />
    </Helmet>
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      {props.children}
    </ThemeProvider>
  </>
);

export default Base;
