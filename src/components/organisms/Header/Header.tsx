import * as React from 'react';
import { Link } from 'gatsby';

import styled, { css } from '@styled';

const Container = styled.header`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: ${p => p.theme.dimensions.use.screen} 0;
`;

const Title = styled(Link)`
  ${p => {
    const f = p.theme.typography.scale(1.2);
    return css`
      font-size: ${f.fontSize};
      line-height: ${f.lineHeight};
    `;
  }};
  color: ${p => p.theme.colors.use.text.primary};
  text-transform: uppercase;

  /* Disable shadow from Typography theme. */
  background-image: none;
`;

const Header: React.FC = () =>
  <Container><Title to="/">Braden Marshall</Title></Container>;

export default Header;
