import * as React from 'react';

import { DateRange } from '@atoms';
import styled from '@styled';

const ImageContainer = styled.span`
  display: flex;
  width: ${p => p.theme.dimensions.base.xLarge};
  height: ${p => p.theme.dimensions.base.xLarge};

  & > a {
    border-bottom: none;

    & > img {
      margin: 0;
      width: 100%;
      height: 100%; 
      object-fit: contain;
    }
  }
`;
const Name = styled.span``;
const Role = styled.span``;
const Location = styled.span``;
const StyledDateRange = styled(DateRange)``;

const Container = styled.section`
  display: grid;
  grid-template-columns: min-content repeat(2, 1fr);
  grid-column-gap: ${p => p.theme.dimensions.use.margin};
  grid-template-rows: repeat(2, 1fr);

  & > ${ImageContainer} {
    grid-area: 1 / 1 / 3 / 1;
    justify-self: center;
    align-self: center;
  }

  & > ${Name} {
    grid-area: 1 / 2;
  }

  & > ${Role} {
    grid-area: 2 / 2;
    align-self: flex-end;
    font-variant-caps: small-caps;
    color: ${p => p.theme.colors.use.text.secondary};
  }

  & > ${Location} {
    grid-area: 1 / 3;
    justify-self: flex-end;
    color: ${p => p.theme.colors.use.accent.secondary};
  }

  & > ${StyledDateRange} {
    grid-area: 2 / 3;
    justify-self: flex-end;
    align-self: flex-end;
  }
`;

interface Props {
  image: string;
  name: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  href: string;
}

const OrganisationBanner: React.FC<Props> = ({
  image,
  name,
  role,
  location,
  startDate,
  endDate,
  href,
}) => (
  <Container>
    <ImageContainer>
      <a href={href}>
        <img src={image} />
      </a>
    </ImageContainer>
    <Name><a href={href}>{name}</a></Name>
    <Role>{role}</Role>
    <Location>{location}</Location>
    <StyledDateRange startDate={startDate} endDate={endDate} />
  </Container>
);

export default OrganisationBanner;
