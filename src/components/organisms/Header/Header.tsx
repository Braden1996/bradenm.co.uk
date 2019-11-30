import * as React from 'react';
import { Link } from 'gatsby';
import { CSSObject } from 'styled-components';

import styled, { css } from '@styled';
import { SocialIcons } from '@molecules';
import config from '@config';

const StyledSocialIcons = styled(SocialIcons)``;

const Container = styled.header`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-top: ${p => p.theme.dimensions.use.screen};
  margin-bottom: ${p => p.theme.dimensions.base.small};

  & > ${StyledSocialIcons} {
    align-self: flex-end;
  }
`;

const Title = styled(Link)`
  ${p => css(p.theme.typography.scale(1.2) as CSSObject)}
  color: ${p => p.theme.colors.use.text.primary};
  text-transform: uppercase;
  text-align: center;

  /* Disable shadow from Typography theme. */
  background-image: none;
`;

const Header: React.FC = () => (
  <Container>
    <Title to="/">{config.site.name}</Title>
    <StyledSocialIcons {...config.site.social} />
  </Container>
);

export default Header;
