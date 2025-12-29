import { UserRepository } from '../repositories/user.repository';
import { RoleRepository } from '../repositories/role.repository';
import { Security } from '../lib/security';
import { BadRequestError, NotFoundError } from '../lib/errors';

const userRepository = new UserRepository();
const roleRepository = new RoleRepository();

export class UserService {
    async getAllUsers() {
        return userRepository.findAll();
    }

    async getUserById(id: string) {
        const user = await userRepository.findById(id);
        if (!user) {
            throw new NotFoundError('User not found');
        }
        return user;
    }

    async createUser(data: {
        name: string;
        email?: string;
        phone?: string;
        password: string;
        roleId: number;
        isActive?: boolean;
    }) {
        // Validate that at least email or phone is provided
        if (!data.email && !data.phone) {
            throw new BadRequestError('Email or phone must be provided');
        }

        // Check if email already exists
        if (data.email) {
            const existingEmail = await userRepository.findByEmail(data.email);
            if (existingEmail) {
                throw new BadRequestError('Email already exists');
            }
        }

        // Check if phone already exists
        if (data.phone) {
            const existingPhone = await userRepository.findByPhone(data.phone);
            if (existingPhone) {
                throw new BadRequestError('Phone already exists');
            }
        }

        // Verify role exists
        const role = await roleRepository.findById(data.roleId);
        if (!role) {
            throw new BadRequestError('Invalid role');
        }

        // Prevent duplicate users: if a user with same name exists, require
        // either a different role or a different phone number. In other words,
        // reject if a user exists with the same name AND same role AND same/empty phone.
        const existingWithName = await userRepository.findByName(data.name);
        if (existingWithName && existingWithName.length > 0) {
            for (const ex of existingWithName) {
                const existingRoleName = (ex as any).role?.name;
                const incomingRoleName = role.name;
                const existingPhone = (ex as any).phone;
                const incomingPhone = data.phone;

                if (existingRoleName === incomingRoleName) {
                    // If both phones exist and are identical -> duplicate
                    if (incomingPhone && existingPhone && incomingPhone === existingPhone) {
                        throw new BadRequestError('A user with the same name, role and phone already exists');
                    }

                    // If either existing or incoming phone is missing, we consider this a potential duplicate
                    if (!incomingPhone || !existingPhone) {
                        throw new BadRequestError('A user with the same name and role already exists. Use a different phone number or role.');
                    }

                    // If phones are both present and different, allow creation
                }
            }
        }

        // Hash password
        const hashedPassword = await Security.hashPassword(data.password);

        return userRepository.create({
            name: data.name,
            email: data.email,
            phone: data.phone,
            password: hashedPassword,
            role: { connect: { id: data.roleId } },
            isActive: data.isActive !== undefined ? data.isActive : true,
        });
    }

    async updateUser(id: string, data: {
        name?: string;
        email?: string;
        phone?: string;
        password?: string;
        roleId?: number;
        isActive?: boolean;
    }) {
        const user = await userRepository.findById(id);
        if (!user) {
            throw new NotFoundError('User not found');
        }

        const updateData: any = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;

        // Handle email update
        if (data.email !== undefined && data.email !== user.email) {
            const existingEmail = await userRepository.findByEmail(data.email);
            if (existingEmail) {
                throw new BadRequestError('Email already exists');
            }
            updateData.email = data.email;
        }

        // Handle phone update
        if (data.phone !== undefined && data.phone !== user.phone) {
            const existingPhone = await userRepository.findByPhone(data.phone);
            if (existingPhone) {
                throw new BadRequestError('Phone already exists');
            }
            updateData.phone = data.phone;
        }

        // Handle password update
        if (data.password) {
            updateData.password = await Security.hashPassword(data.password);
        }

        // Handle role update
        if (data.roleId !== undefined) {
            const role = await roleRepository.findById(data.roleId);
            if (!role) {
                throw new BadRequestError('Invalid role');
            }
            updateData.role = { connect: { id: data.roleId } };
        }

        return userRepository.update(id, updateData);
    }

    async deleteUser(id: string) {
        const user = await userRepository.findById(id);
        if (!user) {
            throw new NotFoundError('User not found');
        }
        return userRepository.delete(id);
    }
}

