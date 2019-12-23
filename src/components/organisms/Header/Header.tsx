import * as React from 'react';
import { Link } from 'gatsby';
import { math } from 'polished';

import styled, { css, media } from '@styled';
import { GithubCorner } from '@atoms';
import { SocialIcons } from '@molecules';
import config from '@config';

const StyledSocialIcons = styled(SocialIcons)``;

const Title = styled(Link)`
  display: flex;
  width: 100%;
  justify-content: center;
  align-items: center;

  ${p => css`
    font-size: ${p.theme.typography.scale(1.2).fontSize};
    line-height: ${p.theme.typography.scale(1.2).fontSize};
  `}
  color: inherit;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: ${p => p.theme.dimensions.base.xSmall};

  &:hover {
    color: ${p => p.theme.colors.use.accent.primary};
  }

  ${p => media.lessThan('default')`
    font-size: ${p.theme.typography.scale(1).fontSize};
    line-height: ${p.theme.typography.scale(1).fontSize};
  `}

  /* Reset Typography theme */
  border-bottom: none;
`;

const Nav = styled.nav`
  display: flex;

  & > * {
    &:not(:first-child) {
      margin-left: ${p => math(`${p.theme.dimensions.use.margin} / 2`)};
    }

    &:not(:last-child) {
      margin-right: ${p => math(`${p.theme.dimensions.use.margin} / 2`)};
    }
  }

  ${media.lessThan('mobile')`
    & > * {
      flex-grow: 1;
      flex-shrink: 1;
      flex-basis: 0;
      text-align: center;
    }
  `}
`;

const StyledLink = styled(Link)`
  color: inherit;
  border-color: inherit;

  &:hover {
    color: ${p => p.theme.colors.use.accent.primary};
  }

  ${media.lessThan('mobile')`
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: ${p => p.theme.dimensions.base.large};
  `}
`;

const Container = styled.header<{ cornerMargin: number}>`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: ${p => p.theme.dimensions.use.margin};
  margin-bottom: ${p => p.theme.dimensions.base.small};

  & > ${Title} {
    min-height: ${p => p.cornerMargin}px;
    padding-left: ${p => p.cornerMargin}px;
    padding-right: ${p => p.cornerMargin}px;
  }

  ${media.lessThan('default')`
    margin: ${p => p.theme.dimensions.base.small};

    & > *:not(:last-child) {
      margin-bottom: ${p => p.theme.dimensions.base.small};
    }
  `}

  ${media.lessThan('mobile')`
    & > ${StyledSocialIcons}, & > ${Nav} {
      width: 100%;
      justify-content: center;
    }
  `}
`;

interface Props {
  className?: string;
  size?: number;
}

const Header: React.FC<Props> = ({ className, size = 65 }) => (
  <>
    <Container className={className} cornerMargin={size}>
      <Title to="/">{config.site.name}</Title>
      <Nav>
        <StyledLink to="/">Blog</StyledLink>
        <StyledLink to="/about">About</StyledLink>
        {/* <StyledLink to="/projects">Projects</StyledLink> */}
      </Nav>
      <StyledSocialIcons {...config.site.social} />
    </Container>
    <GithubCorner size={size} />
  </>
);

export default Header;
