import * as React from 'react';

import { EnergyDrink } from '@atoms';
import styled from '@styled';

const Container = styled.footer`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: ${p => p.theme.dimensions.use.margin} 0;
  color: ${p => p.theme.colors.use.text.primary};
`;

const Footer: React.FC = () =>
  <Container>Made with <EnergyDrink /> in London</Container>;

export default Footer;
