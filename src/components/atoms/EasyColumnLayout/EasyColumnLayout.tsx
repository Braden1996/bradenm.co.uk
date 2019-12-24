import * as React from 'react';

import styled, { media, theme } from '@styled';

interface ContainerProps {
  collapse?: keyof typeof theme.dimensions.use.breakpoints;
}

const Container = styled.section<Props>`
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

  ${p => media.greaterThan(p.collapse || 'default')`
    flex-direction: row;
  `}
`;

interface Props extends ContainerProps {
  children: React.ReactChildren;
}

const EasyColumnLayout: React.FC<Props> = ({ children, ...containerProps }) => (
  <Container {...containerProps}>
    {children}
  </Container>
);

export default EasyColumnLayout;
