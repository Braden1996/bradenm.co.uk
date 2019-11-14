import { PageRendererProps } from 'gatsby';
import { Global, css } from '@emotion/core';
import * as React from 'react';
import Helmet from 'react-helmet';

// @ts-ignore
import favicon from '../../src/favicon.ico';

export interface Props extends PageRendererProps {
  className?: string;
}

const GlobalStyles = css``;

const IndexLayout: React.FC<Props> = props => (
  <div className={props.className}>
    <Helmet>
      <link rel="icon" href={favicon} type="image/x-icon" />
    </Helmet>
    <Global styles={GlobalStyles} />
    {props.children}
  </div>
);

export default IndexLayout;
