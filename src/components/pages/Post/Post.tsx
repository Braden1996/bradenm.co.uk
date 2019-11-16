import * as React from 'react';

import { Base } from '@templates';
import config from '@config';

const IndexPage: React.FC<React.ComponentProps<typeof Base>> = props => (
  <Base {...props}>
    <header >
      <h1>{config.site.title}</h1>
    </header>
    <main id="site-main">
      <p>Test</p>
    </main>
    {props.children}
  </Base>
);

export default IndexPage;
