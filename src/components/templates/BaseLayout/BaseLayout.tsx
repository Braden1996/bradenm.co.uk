import * as React from 'react';
import styled from '@emotion/styled';

import Base from '../Base';

const Container = styled.article`
  background-color: pink;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const Header = styled.header`
  background-color: green;
  width: 100%;
  height: 20vh;
`;

const Content = styled.main`
  background-color: pink;
  width: 100%;
  flex: 1;
`;

const BaseLayout: React.FC<React.ComponentProps<typeof Base>> = props => (
  <Base {...props}>
    <Container>
      <Header />
      <Content>
        {props.children}
      </Content>
    </Container>
  </Base>
);

export default BaseLayout;
