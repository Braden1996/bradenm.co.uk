import * as React from 'react';
import styled from '@emotion/styled';

import { EnergyDrink } from '@atoms';
import config from '@config';

const Container = styled.footer`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: ${config.dimensions.use.margin} 0;
`;

const Footer: React.FC = () =>
  <Container>Made with <EnergyDrink /> in London</Container>;

export default Footer;
