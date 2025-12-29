import { Security } from '../lib/security';
import { config } from '../config';
import { UserRepository } from '../repositories/user.repository';
import { RefreshSessionRepository } from '../repositories/refreshSession.repository';
import { UserDeviceRepository } from '../repositories/userDevice.repository';
import { LocationRepository } from '../repositories/location.repository';
import { UnauthorizedError } from '../lib/errors';
import { getRedis } from '../lib/redis';

const userRepository = new UserRepository();
const refreshSessionRepository = new RefreshSessionRepository();
const userDeviceRepository = new UserDeviceRepository();
const locationRepository = new LocationRepository();

interface LoginRequest {
    email?: string;
    phone?: string;
    password: string;
    deviceId: string;
    deviceName?: string;
    lat?: number;
    lng?: number;
    ip?: string;
    userAgent?: string;
}

export class AuthService {

    async login(data: LoginRequest) {
        const { email, phone, password, deviceId, deviceName, lat, lng } = data;

        let user;
        if (email) user = await userRepository.findByEmail(email);
        else if (phone) user = await userRepository.findByPhone(phone);

        if (!user || !user.isActive) {
            throw new UnauthorizedError('Invalid credentials');
        }

        const isPasswordValid = await Security.comparePassword(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedError('Invalid credentials');
        }

        await userDeviceRepository.upsert(user.id, deviceId, {
            deviceName,
            lastLat: lat,
            lastLng: lng,
        });

        if (lat && lng) {
            await locationRepository.create({
                userId: user.id,
                deviceId,
                type: 'login',
                lat,
                lng,
            });
        }

        // ✅ Create refresh session (DB is source of truth)
        const refreshToken = Security.generateRefreshToken();
        const refreshTokenHash = Security.hashToken(refreshToken);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpirationDays);

        const session = await refreshSessionRepository.create({
            userId: user.id,
            deviceId,
            refreshTokenHash,
            expiresAt,
            ip: data.ip,
            userAgent: data.userAgent,
        });

        // ✅ Redis session cache (OPTIONAL)
        const redis = getRedis();
        if (redis) {
            const redisKey = `session:${session.id}`;
            const inactivityTimeout =
                config.session.inactivityTimeoutMinutes[user.role.name as keyof typeof config.session.inactivityTimeoutMinutes] ??
                config.session.inactivityTimeoutMinutes.default;

            await redis.setex(redisKey, inactivityTimeout * 60, user.id);
        }

        const accessToken = Security.generateAccessToken({
            userId: user.id,
            role: user.role.name,
            sessionId: session.id,
        });

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role.name,
            },
        };
    }

    async refresh(refreshToken: string) {
        const refreshTokenHash = Security.hashToken(refreshToken);
        const session = await refreshSessionRepository.findByTokenHash(refreshTokenHash);

        if (!session || session.revoked) {
            throw new UnauthorizedError('Invalid refresh token');
        }

        if (new Date() > session.expiresAt) {
            throw new UnauthorizedError('Refresh token expired');
        }

        // ✅ Redis inactivity check (OPTIONAL)
        const redis = getRedis();
        if (redis) {
            const redisKey = `session:${session.id}`;
            const exists = await redis.exists(redisKey);
            if (!exists) {
                throw new UnauthorizedError('Session expired due to inactivity');
            }

            const inactivityTimeout =
                config.session.inactivityTimeoutMinutes[session.user.role.name as keyof typeof config.session.inactivityTimeoutMinutes] ??
                config.session.inactivityTimeoutMinutes.default;

            await redis.expire(redisKey, inactivityTimeout * 60);
        }

        await refreshSessionRepository.update(session.id, { lastUsedAt: new Date() });

        const accessToken = Security.generateAccessToken({
            userId: session.userId,
            role: session.user.role.name,
            sessionId: session.id,
        });

        return { accessToken };
    }

    async logout(refreshToken: string) {
        const refreshTokenHash = Security.hashToken(refreshToken);
        const session = await refreshSessionRepository.findByTokenHash(refreshTokenHash);

        if (session) {
            await refreshSessionRepository.revoke(session.id);

            const redis = getRedis();
            if (redis) {
                await redis.del(`session:${session.id}`);
            }
        }
    }
}
