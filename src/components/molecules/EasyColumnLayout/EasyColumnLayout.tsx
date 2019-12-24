import * as React from 'react';

import styled, { media } from '@styled';

const Container = styled.section`
  display: flex;
  flex-direction: column;

  & > * {
    flex: 1;

    &:not(:first-child) {
      margin-left: ${p => p.theme.dimensions.use.margin};
    }

    &:not(:last-child) {
      margin-right: ${p => p.theme.dimensions.use.margin};
    }
  }

  ${media.greaterThan('default')`
    flex-direction: row;
  `}
`;

interface Props {
  children: React.ReactChildren;
}

const EasyColumnLayout: React.FC<Props> = ({ children }) => (
  <Container>
    {children}
  </Container>
);

export default EasyColumnLayout;
