import * as React from 'react';

import { Footer } from '@organisms';
import styled from '@styled';

import Base from '../Base';

const Container = styled.article`
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const Header = styled.header`
  width: 100%;
  height: 20vh;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const Content = styled.main`
  ${p => p.theme.shadows.medium};
  background-color: ${p => p.theme.colors.use.background.primary};
  width: 100%;
  flex: 1;
  border-radius: ${p => p.theme.dimensions.use.borderRadius.large};
  padding: ${p => p.theme.dimensions.use.margin};
`;

const BaseLayout: React.FC<React.ComponentProps<typeof Base>> = props => (
  <Base {...props}>
    <Container>
      <Header>
        <h1>Braden Marshall</h1>
      </Header>
      <Content>{props.children}</Content>
      <Footer />
    </Container>
  </Base>
);

export default BaseLayout;
