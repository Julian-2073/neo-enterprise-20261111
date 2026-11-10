'use client';
import type {ComponentProps} from 'react';
import {EvidenceDrawer as OriginalDrawer} from './evidence-drawer.tsx';
import {OperatingEvidenceDrawer} from './operating-evidence-drawer';
import {CustomerPulseDrawer} from './customer-pulse-drawer';
export function EvidenceDrawer(props:ComponentProps<typeof OriginalDrawer>){
 if(!props.backend)return <OriginalDrawer {...props}/>;
 return props.backend.id.includes(':view:customer-pulse:')?<CustomerPulseDrawer reference={props.backend} onClose={props.onClose}/>:<OperatingEvidenceDrawer reference={props.backend} onClose={props.onClose}/>;
}
