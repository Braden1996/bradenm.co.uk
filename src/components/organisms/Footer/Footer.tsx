import * as React from 'react';

import { EnergyDrink } from '@atoms';
import styled, { css } from '@styled';

const Container = styled.footer`
  ${p => css`
    font-size: ${p.theme.typography.scale(-0.2).fontSize};
    line-height: ${p.theme.typography.scale(-0.2).fontSize};
  `}
  display: flex;
  justify-content: center;
  align-items: center;
  margin: ${p => p.theme.dimensions.use.margin} 0;
  color: ${p => p.theme.colors.use.text.primary};
`;

const Footer: React.FC = () =>
  <Container>Made with <EnergyDrink /> in London</Container>;

export default Footer;
