'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from '../router/react-router-dom';
import { useAuth } from '../context/AuthContext';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
    const { t } = useTranslation('common');
    const { token, admin, isLoading } = useAuth();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const loadingView = (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh'
        }}>{mounted ? t('status.loading') : 'Loading...'}</div>
    );

    if (isLoading || (token && !admin)) {
        return loadingView;
    }

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    // 展示项目：所有已登录账号（super_admin/admin/support）均可用全部功能，不做角色路由限制
    return <>{children}</>;
};
