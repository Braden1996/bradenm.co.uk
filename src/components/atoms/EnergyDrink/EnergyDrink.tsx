import * as React from 'react';
import { transparentize } from 'polished';

import styled from '@styled';

import energyDrink from './energyDrink.png';

const Icon = styled.img`
  position: absolute;
  top: 0;
  left: 50%;
  right: 50%;
  height: 100%;
  transform: translate(-50%);
  transition: transform 200ms linear;

  &:hover {
    filter: drop-shadow(1px 1px 1px ${p => transparentize(0.7, p.theme.colors.base.black)});
    transform: translate(-50%) scale(1.33) rotate(15deg);
  }
`;

const EnergyDrinkLink = styled.a`
  position: relative;
  width: 1em;
  height: 1.5em;
  margin: 0 0.1em;
  cursor: pointer;
`;

const EnergyDrink = () => (
  <EnergyDrinkLink rel="nofollow" href="https://examine.com/nutrition/are-energy-drinks-bad-for-you/">
    <Icon alt="energy drink" src={energyDrink} />
  </EnergyDrinkLink>
);

export default EnergyDrink;
