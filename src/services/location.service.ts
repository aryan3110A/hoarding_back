import { LocationRepository } from '../repositories/location.repository';
import { Prisma } from '@prisma/client';

const locationRepository = new LocationRepository();

export class LocationService {
    async logLocation(data: Prisma.LocationLogUncheckedCreateInput) {
        return locationRepository.create(data);
    }
}
