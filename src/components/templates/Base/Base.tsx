import { PageRendererProps } from 'gatsby';
import { Global, css } from '@emotion/core';
import * as React from 'react';
import Helmet from 'react-helmet';
import normalize from 'normalize.css';

import config from '@config';

// @ts-ignore
import favicon from './favicon.ico';

export interface Props extends PageRendererProps {
  className?: string;
}

const GlobalStyles = css`
  ${normalize}
  html {
    box-sizing: border-box;
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
      <html lang={config.lang} />
      <title>{config.title}</title>
      <meta name="description" content={config.description} />
      <meta property="og:site_name" content={config.title} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={config.title} />
      <meta property="og:description" content={config.description} />
      <meta property="og:url" content={config.siteUrl} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={config.title} />
      <meta name="twitter:description" content={config.description} />
      <meta name="twitter:url" content={config.siteUrl} />
      {config.twitter && (
        <meta
          name="twitter:site"
          content={`@${config.twitter.split('https://twitter.com/')[1]}`}
        />
      )}
      <link rel="icon" href={favicon} type="image/x-icon" />
    </Helmet>
    <Global styles={GlobalStyles} />
    {props.children}
  </>
);

export default Base;
