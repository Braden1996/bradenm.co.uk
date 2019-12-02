import * as React from 'react';

import { Footer, Header } from '@organisms';
import styled from '@styled';

import Base from '../Base';

const Container = styled.article`
  width: 100%;
  max-width: ${p => p.theme.dimensions.use.breakpoints.default};
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const Content = styled.main`
  width: 100%;
  flex: 1;
`;

const BaseLayout: React.FC<React.ComponentProps<typeof Base>> = props => (
  <Base {...props}>
    <Container>
      <Header />
      <Content>{props.children}</Content>
      <Footer />
    </Container>
  </Base>
);

export default BaseLayout;
