import * as React from 'react';
import { transparentize } from 'polished';

import styled from '@styled';

import energyDrink from './energyDrink.png';

const Icon = styled.img`
  height: 1em;
  transition: transform 200ms linear;
  vertical-align: text-top;
  transform: scale(1.5);

  /* Reset Typography theme */
  margin-bottom: 0;

  &:hover {
    filter: drop-shadow(1px 1px 1px ${p => transparentize(0.7, p.theme.colors.base.black)});
    transform: scale(2) rotate(15deg);
  }
`;

const EnergyDrinkLink = styled.a`
  position: relative;
  margin: 0 0.1em;
  cursor: pointer;
  
  /* Reset Typography theme */
  border-bottom: none;
  margin-bottom: 0;
`;

const EnergyDrink = () => (
  <EnergyDrinkLink tabIndex={-1} rel="nofollow" href="https://examine.com/nutrition/are-energy-drinks-bad-for-you/">
    <Icon alt="energy drink" src={energyDrink} />
  </EnergyDrinkLink>
);

export default EnergyDrink;
