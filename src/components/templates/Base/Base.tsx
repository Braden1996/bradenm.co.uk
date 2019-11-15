import { PageRendererProps } from 'gatsby';
import { Global, css } from '@emotion/core';
import * as React from 'react';
import Helmet from 'react-helmet';
import normalize from 'normalize.css';

// @ts-ignore
import favicon from './favicon.ico';

export interface Props extends PageRendererProps {
  className?: string;
}

const GlobalStyles = css`${normalize}`;

const IndexLayout: React.FC<Props> = props => (
  <>
    <Helmet>
      <link rel="icon" href={favicon} type="image/x-icon" />
    </Helmet>
    <Global styles={GlobalStyles} />
    {props.children}
  </>
);

export default IndexLayout;
